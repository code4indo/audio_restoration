"use client";

import { useState, useEffect } from "react";
import Header from "@/components/Header";
import HistoryPanel from "@/components/HistoryPanel";
import AudioUploader from "@/components/AudioUploader";
import WaveformEditor from "@/components/WaveformEditor";
import SeparationPanel from "@/components/SeparationPanel";
import ProgressTracker from "@/components/ProgressTracker";
import StemMixer from "@/components/StemMixer";
import VideoStemMixer from "@/components/VideoStemMixer";
import BatchQueue from "@/components/BatchQueue";

interface TaskResult {
  original_path: string;
  ghost_path: string;
  clean_path: string;
  description: string;
  mode: string;
  audio_duration?: number;
  processing_time?: number;
  model_size?: string;
  video_path?: string;
  is_video?: boolean;
  audio_metadata?: {
    sample_rate?: number;
    channels?: number;
    bit_depth?: number;
    codec?: string;
    format?: string;
    file_size_bytes?: number;
    original_filename?: string;
  };
}

interface TaskState {
  taskId: string | null;
  sourceTaskId: string | null;
  status: "idle" | "uploading" | "pending" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
  result: TaskResult | null;
}

export default function Home() {
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<{ start: number; end: number } | null>(null);

  // Persistent separation settings (won't reset on "New")
  const [separationSettings, setSeparationSettings] = useState({
    modelSize: "base" as "small" | "base" | "large",
    chunkDuration: 25,
    useFloat32: false,
  });

  const [task, setTask] = useState<TaskState>({
    taskId: null,
    sourceTaskId: null,
    status: "idle",
    progress: 0,
    message: "",
    result: null,
  });

  const [batchMode, setBatchMode] = useState(false);
  const [batchProcessing, setBatchProcessing] = useState(false);

  // Toggle theme
  useEffect(() => {
    document.body.classList.toggle("light-mode", !isDarkMode);
  }, [isDarkMode]);

  const handleFileUpload = (file: File) => {
    setAudioFile(file);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    // Detect if file is video
    const isVideoFile = file.type.startsWith("video/") ||
      /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name);
    setIsVideo(isVideoFile);

    // Reset task state
    setTask({
      taskId: null,
      sourceTaskId: null,
      status: "idle",
      progress: 0,
      message: "",
      result: null,
    });
  };

  const handleRestoreFromHistory = (taskId: string, result: TaskResult) => {
    // Restore a completed task from history into the main view
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioFile(null);
    // Use the original output audio as the preview URL
    setAudioUrl(`/outputs/${taskId}.original.wav`);
    setIsVideo(!!result.is_video);
    setSelectedRegion(null);
    setTask({
      taskId,
      sourceTaskId: taskId,
      status: "completed",
      progress: 100,
      message: "",
      result,
    });
  };

  // Submit a new separation using an already-uploaded file on the server
  const handleReprocess = async (
    sourceTaskId: string,
    description: string,
    mode: "extract" | "remove",
    modelSize: string,
    chunkDuration: number,
    useFloat32: boolean
  ) => {
    setTask(prev => ({
      ...prev,
      status: "pending",
      progress: 0,
      message: "Submitting task...",
      result: null,
    }));

    try {
      const formData = new FormData();
      formData.append("source_task_id", sourceTaskId);
      formData.append("description", description);
      formData.append("mode", mode);
      formData.append("model_size", modelSize);
      formData.append("chunk_duration", chunkDuration.toString());
      formData.append("use_float32", useFloat32.toString());

      const res = await fetch("/api/separate/reprocess", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Reprocess failed");

      setTask({
        taskId: data.task_id,
        sourceTaskId,
        status: "pending",
        progress: 0,
        message: "Task submitted...",
        result: null,
      });
      pollTaskStatus(data.task_id, sourceTaskId);
    } catch (error) {
      setTask(prev => ({
        ...prev,
        status: "failed",
        message: error instanceof Error ? error.message : "Reprocess failed",
      }));
    }
  };

  const handleReset = () => {
    // Clean up the object URL to free memory
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioFile(null);
    setAudioUrl(null);
    setIsVideo(false);
    setSelectedRegion(null);
    setTask({
      taskId: null,
      sourceTaskId: null,
      status: "idle",
      progress: 0,
      message: "",
      result: null,
    });
  };

  const handleSeparation = async (
    description: string,
    mode: "extract" | "remove",
    modelSize: string = "base",
    chunkDuration: number = 25,
    useFloat32: boolean = false
  ) => {
    // If we have an existing upload on the server, skip re-upload
    if (task.sourceTaskId) {
      return handleReprocess(task.sourceTaskId, description, mode, modelSize, chunkDuration, useFloat32);
    }

    if (!audioFile) return;

    const formData = new FormData();
    formData.append("file", audioFile);
    formData.append("description", description);
    formData.append("mode", mode);
    formData.append("model_size", modelSize);
    formData.append("chunk_duration", chunkDuration.toString());
    formData.append("use_float32", useFloat32.toString());

    if (selectedRegion) {
      formData.append("start_time", selectedRegion.start.toString());
      formData.append("end_time", selectedRegion.end.toString());
    }

    setTask({
      taskId: null,
      sourceTaskId: null,
      status: "uploading",
      progress: 0,
      message: "Uploading file...",
      result: null,
    });

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setTask(prev => ({
            ...prev,
            progress: pct,
            message: `Uploading… ${pct}%`,
          }));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            setTask({
              taskId: data.task_id,
              sourceTaskId: null,
              status: "pending",
              progress: 0,
              message: "Task submitted...",
              result: null,
            });
            pollTaskStatus(data.task_id, null);
            resolve();
          } catch {
            reject(new Error("Invalid server response"));
          }
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.onabort = () => reject(new Error("Upload aborted"));

      xhr.open("POST", "/api/separate/");
      xhr.send(formData);
    }).catch((error) => {
      console.error("Failed to submit separation task:", error);
      setTask(prev => ({
        ...prev,
        status: "failed",
        message: error.message || "Failed to submit task",
      }));
    });
  };

  const pollTaskStatus = async (taskId: string, sourceTaskId: string | null = null) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        const data = await res.json();

        setTask({
          taskId,
          status: data.status,
          sourceTaskId,
          progress: data.progress,
          message: data.message || "",
          result: data.result || null,
        });

        if (data.status !== "completed" && data.status !== "failed") {
          setTimeout(poll, 1000);
        }
      } catch (error) {
        console.error("Failed to poll task status:", error);
      }
    };

    poll();
  };

  return (
    <>
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg-primary)",
        width: "100%"
      }}
    >
      <Header
        isDarkMode={isDarkMode}
        onThemeToggle={() => setIsDarkMode(!isDarkMode)}
        onLogoClick={handleReset}
        onHistoryClick={() => setShowHistory(true)}
      />

      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "32px 24px"
        }}
      >
        {/* Hero Section */}
        {!audioUrl && !batchMode && (
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <h1 style={{ fontSize: "3rem", fontWeight: 800, marginBottom: "16px" }}>
              <span className="gradient-text">SoundPrism</span>
            </h1>
            <p style={{ fontSize: "1.25rem", marginBottom: "8px", color: "var(--text-secondary)" }}>
              AI-Powered Audio Separation & Restoration
            </p>
            <p style={{ color: "var(--text-muted)" }}>
              Like a prism splits light into colors, SoundPrism separates mixed audio into individual sounds. Isolate vocals, extract instruments, remove noise with state-of-the-art AI.
            </p>
          </div>
        )}

        {/* Batch Mode Toggle (shown when no file is loaded) */}
        {!audioUrl && (
          <div style={{ textAlign: "center", marginBottom: "24px" }}>
            <button
              onClick={() => setBatchMode(!batchMode)}
              style={{
                padding: "10px 20px",
                borderRadius: "10px",
                border: `1px solid ${batchMode ? "var(--ghost-primary)" : "var(--glass-border)"}`,
                background: batchMode ? "rgba(168, 85, 247, 0.1)" : "var(--bg-secondary)",
                color: batchMode ? "var(--ghost-primary)" : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                transition: "all 0.2s",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="2" width="8" height="8" rx="1" />
                <rect x="14" y="2" width="8" height="8" rx="1" />
                <rect x="2" y="14" width="8" height="8" rx="1" />
                <rect x="14" y="14" width="8" height="8" rx="1" />
              </svg>
              {batchMode ? "Exit Batch Mode" : "Batch Processing Mode"}
            </button>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: "12px" }}>
              Process multiple intents on the same file
            </span>
          </div>
        )}

        {/* Batch Queue Panel */}
        {batchMode && !audioUrl && (
          <div style={{ marginBottom: "24px" }}>
            <BatchQueue
              onStartBatch={async (items) => {
                setBatchProcessing(true);
                for (const item of items) {
                  try {
                    const formData = new FormData();
                    // Use a demo file or prompt user to upload
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = "audio/*,video/*";
                    const file = await new Promise<File>((resolve) => {
                      input.onchange = () => resolve(input.files![0]);
                      input.click();
                    });
                    formData.append("file", file);
                    formData.append("description", item.description);
                    formData.append("mode", item.mode);
                    formData.append("model_size", "base");

                    const res = await fetch("/api/separate/", {
                      method: "POST",
                      body: formData,
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  } catch (e) {
                    console.error("Batch item failed:", item.filename, e);
                  }
                }
                setBatchProcessing(false);
              }}
              processing={batchProcessing}
            />
          </div>
        )}

        {/* Main Content */}
        <div style={{ display: "grid", gap: "24px" }}>
          {/* Upload Zone */}
          {!audioUrl && !batchMode && (
            <AudioUploader onFileUpload={handleFileUpload} />
          )}

          {/* Waveform Editor (Audio) or Video Preview - Hide when results are shown or uploading */}
          {audioUrl && task.status !== "completed" && task.status !== "uploading" && (
            <>
              {/* Section Header with Upload Button */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--text-primary)" }}>
                  {isVideo ? "Video Preview" : "Audio Editor"}
                </h2>
                <button
                  onClick={handleReset}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: "var(--bg-tertiary)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-color)",
                    cursor: "pointer",
                    fontSize: "0.875rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    transition: "all 0.2s ease"
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = "var(--bg-secondary)"}
                  onMouseOut={(e) => e.currentTarget.style.background = "var(--bg-tertiary)"}
                >
                  ↩ Upload New File
                </button>
              </div>

              {/* Show Video Player or Waveform based on file type */}
              {isVideo ? (
                <div
                  style={{
                    background: "var(--bg-secondary)",
                    borderRadius: "16px",
                    border: "1px solid var(--glass-border)",
                    padding: "16px",
                    overflow: "hidden"
                  }}
                >
                  <video
                    src={audioUrl}
                    controls
                    style={{
                      width: "100%",
                      maxHeight: "400px",
                      borderRadius: "12px",
                      background: "#000",
                      objectFit: "contain"
                    }}
                  />
                  <p style={{
                    fontSize: "0.8rem",
                    color: "var(--text-muted)",
                    marginTop: "12px",
                    textAlign: "center"
                  }}>
                    Audio will be extracted from this video for separation processing
                  </p>
                </div>
              ) : (
                <WaveformEditor
                  audioUrl={audioUrl}
                  onRegionSelect={setSelectedRegion}
                  selectedRegion={selectedRegion}
                />
              )}
            </>
          )}


          {/* Separation Controls */}
          {audioUrl && task.status === "idle" && (
            <SeparationPanel
              onSeparate={handleSeparation}
              hasRegion={!!selectedRegion}
              settings={separationSettings}
              onSettingsChange={setSeparationSettings}
            />
          )}

          {/* Progress Tracker — shown during upload and processing */}
          {(task.status === "uploading" || task.status === "pending" || task.status === "processing") && (
            <ProgressTracker
              status={task.status}
              progress={task.progress}
              message={task.message}
            />
          )}

          {/* Results - Stem Mixer (Audio) or Video Stem Mixer */}
          {task.status === "completed" && task.result && task.taskId && (
            task.result.is_video ? (
              <VideoStemMixer
                taskId={task.taskId}
                description={task.result.description}
                audioDuration={task.result.audio_duration}
                processingTime={task.result.processing_time}
                modelSize={task.result.model_size}
                audioMetadata={task.result.audio_metadata}
                onUploadNew={handleReset}
                onNewSeparation={() => {
                  setTask(prev => ({
                    ...prev,
                    taskId: null,
                    sourceTaskId: prev.taskId,
                    status: "idle",
                    progress: 0,
                    message: "",
                    result: null,
                  }));
                }}
              />
            ) : (
              <StemMixer
                taskId={task.taskId}
                description={task.result.description || task.result.mode || ""}
                audioDuration={task.result.audio_duration}
                processingTime={task.result.processing_time}
                modelSize={task.result.model_size}
                mode={(task.result.mode as "extract" | "remove") || "extract"}
                chunkDuration={separationSettings.chunkDuration}
                useFloat32={separationSettings.useFloat32}
                audioMetadata={task.result.audio_metadata}
                onUploadNew={handleReset}
                onNewSeparation={() => {
                  setTask(prev => ({
                    ...prev,
                    taskId: null,
                    sourceTaskId: prev.taskId,
                    status: "idle",
                    progress: 0,
                    message: "",
                    result: null,
                  }));
                }}
              />
            )
          )}

          {/* Error State */}
          {task.status === "failed" && (
            <div className="glass-card p-6 text-center">
              <div className="text-red-400 text-xl mb-2">❌ Separation Failed</div>
              <p style={{ color: "var(--text-secondary)" }}>{task.message}</p>
              <button
                className="btn-primary mt-4"
                onClick={() => setTask({ taskId: null, sourceTaskId: null, status: "idle", progress: 0, message: "", result: null })}
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>

    </main>

      {/* History Drawer */}
      {showHistory && (
        <HistoryPanel
          onClose={() => setShowHistory(false)}
          onRestore={handleRestoreFromHistory}
        />
      )}
    </>
  );
}
