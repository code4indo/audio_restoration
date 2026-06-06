"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
    Play,
    Pause,
    Download,
    Volume2,
    VolumeX,
    RefreshCw,
    Ghost,
    Leaf,
    SkipBack,
    Music,
    BarChart3,
    FileText,
    CircleDot,
    type LucideIcon
} from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import SpectralAnalyzer from "./SpectralAnalyzer";
import RestorationReport from "./RestorationReport";

interface StemMixerProps {
    taskId: string;
    description: string;
    onNewSeparation: () => void;
    onUploadNew?: () => void;
    audioDuration?: number;
    processingTime?: number;
    modelSize?: string;
    mode?: "extract" | "remove";
    chunkDuration?: number;
    useFloat32?: boolean;
    audioMetadata?: {
        sample_rate?: number;
        channels?: number;
        bit_depth?: number;
        codec?: string;
        format?: string;
        file_size_bytes?: number;
        original_filename?: string;
    };
}

interface Track {
    id: "original" | "ghost" | "clean";
    label: string;
    icon: LucideIcon;
    color: string;
    waveColor: string;
}

const TRACKS: Track[] = [
    {
        id: "original",
        label: "Original Sound",
        icon: CircleDot,
        color: "#F59E0B",
        waveColor: "#F59E0B"
    },
    {
        id: "ghost",
        label: "Isolated Sound",
        icon: Ghost,
        color: "#F472B6",
        waveColor: "#F472B6"
    },
    {
        id: "clean",
        label: "Without Isolated Sound",
        icon: Leaf,
        color: "#60A5FA",
        waveColor: "#60A5FA"
    },
];

export default function StemMixer({
    taskId,
    description,
    onNewSeparation,
    onUploadNew,
    audioDuration,
    processingTime,
    modelSize,
    mode = "extract",
    chunkDuration = 25,
    useFloat32 = false,
    audioMetadata,
}: StemMixerProps) {
    const [activeTab, setActiveTab] = useState<"playback" | "spectrogram" | "report">("playback");
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [muted, setMuted] = useState<Record<string, boolean>>({
        original: false,
        ghost: false,
        clean: false,
    });
    const [isReady, setIsReady] = useState<Record<string, boolean>>({
        original: false,
        ghost: false,
        clean: false,
    });
    const [selectedTrack, setSelectedTrack] = useState<"original" | "ghost" | "clean">(
        mode === "extract" ? "ghost" : "clean"
    );

    const wavesurferRefs = useRef<Record<string, WaveSurfer | null>>({});
    const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const isSeeking = useRef(false);

    const getAudioUrl = (trackId: string) => {
        return `/api/tasks/${taskId}/download/${trackId}`;
    };

    useEffect(() => {
        let isMounted = true;
        const abortController = new AbortController();

        const initWaveSurfers = async () => {
            for (const track of TRACKS) {
                if (!isMounted) return;

                const container = containerRefs.current[track.id];
                if (!container) continue;

                if (wavesurferRefs.current[track.id]) {
                    try {
                        wavesurferRefs.current[track.id]?.unAll();
                        wavesurferRefs.current[track.id]?.destroy();
                    } catch (e) {
                        // Ignore
                    }
                    wavesurferRefs.current[track.id] = null;
                }

                if (!isMounted) return;

                const ws = WaveSurfer.create({
                    container,
                    waveColor: `${track.waveColor}40`,
                    progressColor: track.waveColor,
                    cursorColor: "#ffffff",
                    cursorWidth: 1,
                    barWidth: 2,
                    barGap: 2,
                    barRadius: 2,
                    height: 48,
                    normalize: true,
                    interact: true,
                    hideScrollbar: true,
                });

                ws.on("error", (err) => {
                    console.error(`[StemMixer] WaveSurfer error for ${track.id}:`, err);
                });

                try {
                    ws.load(getAudioUrl(track.id)).catch(() => {});
                } catch (e) {
                    continue;
                }

                ws.on("ready", () => {
                    if (!isMounted) return;
                    setIsReady(prev => ({ ...prev, [track.id]: true }));
                    if (track.id === "ghost") {
                        setDuration(ws.getDuration());
                    }
                    ws.setMuted(muted[track.id]);
                });

                ws.on("audioprocess", () => {
                    if (!isMounted) return;
                    if (!isSeeking.current && track.id === "ghost") {
                        setCurrentTime(ws.getCurrentTime());
                    }
                });

                ws.on("finish", () => {
                    if (!isMounted) return;
                    if (track.id === "ghost") {
                        setIsPlaying(false);
                        setCurrentTime(0);
                        Object.values(wavesurferRefs.current).forEach(w => {
                            if (w) {
                                try {
                                    w.pause();
                                    w.seekTo(0);
                                } catch { /* ignore */ }
                            }
                        });
                    }
                });

                ws.on("seeking", () => {
                    if (!isMounted) return;
                    if (isSeeking.current) return;

                    isSeeking.current = true;
                    const progress = ws.getCurrentTime() / ws.getDuration();

                    Object.entries(wavesurferRefs.current).forEach(([id, w]) => {
                        if (w && id !== track.id) {
                            try {
                                w.seekTo(progress);
                            } catch { /* ignore */ }
                        }
                    });

                    setCurrentTime(ws.getCurrentTime());

                    setTimeout(() => {
                        isSeeking.current = false;
                    }, 50);
                });

                wavesurferRefs.current[track.id] = ws;
            }
        };

        initWaveSurfers();

        return () => {
            isMounted = false;
            abortController.abort();

            const refs = { ...wavesurferRefs.current };
            Object.entries(refs).forEach(([id, ws]) => {
                if (ws) {
                    try {
                        ws.unAll();
                        ws.pause();
                        ws.destroy();
                    } catch (e) {
                        // Ignore
                    }
                }
            });
            wavesurferRefs.current = {};
        };
    }, [taskId]);

    // Continuous sync effect
    useEffect(() => {
        let animationFrameId: number;
        const syncInterval = 100;
        let lastSync = 0;

        const syncTracks = (timestamp: number) => {
            if (isPlaying && timestamp - lastSync > syncInterval) {
                lastSync = timestamp;
                const originalWs = wavesurferRefs.current["original"];
                if (originalWs) {
                    const masterTime = originalWs.getCurrentTime();
                    const masterDuration = originalWs.getDuration();
                    const progress = masterTime / masterDuration;

                    if (masterTime >= masterDuration - 0.1) {
                        Object.values(wavesurferRefs.current).forEach(ws => ws?.pause());
                        Object.values(wavesurferRefs.current).forEach(ws => ws?.seekTo(0));
                        setIsPlaying(false);
                        setCurrentTime(0);
                        return;
                    }

                    Object.entries(wavesurferRefs.current).forEach(([id, ws]) => {
                        if (ws && id !== "original") {
                            const trackTime = ws.getCurrentTime();
                            if (Math.abs(trackTime - masterTime) > 0.05) {
                                ws.seekTo(progress);
                            }
                        }
                    });

                    setCurrentTime(masterTime);
                }
            }
            animationFrameId = requestAnimationFrame(syncTracks);
        };

        if (isPlaying) {
            animationFrameId = requestAnimationFrame(syncTracks);
        }

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, [isPlaying]);

    const togglePlayAll = useCallback(() => {
        const allReady = Object.values(isReady).every(r => r);
        if (!allReady) return;

        if (isPlaying) {
            Object.values(wavesurferRefs.current).forEach(ws => ws?.pause());
            setIsPlaying(false);
        } else {
            const originalWs = wavesurferRefs.current["original"];
            if (originalWs) {
                const progress = originalWs.getCurrentTime() / originalWs.getDuration();
                Object.entries(wavesurferRefs.current).forEach(([id, ws]) => {
                    if (ws && id !== "original") {
                        ws.seekTo(progress);
                    }
                });
            }

            Object.values(wavesurferRefs.current).forEach(ws => ws?.play());
            setIsPlaying(true);
        }
    }, [isPlaying, isReady]);

    const resetToStart = useCallback(() => {
        Object.values(wavesurferRefs.current).forEach(ws => {
            if (ws) {
                ws.pause();
                ws.seekTo(0);
            }
        });
        setIsPlaying(false);
        setCurrentTime(0);
    }, []);

    const toggleMute = useCallback((trackId: string) => {
        const ws = wavesurferRefs.current[trackId];
        if (ws) {
            const newMuted = !muted[trackId];
            ws.setMuted(newMuted);
            setMuted(prev => ({ ...prev, [trackId]: newMuted }));
        }
    }, [muted]);

    const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const progress = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

        isSeeking.current = true;
        Object.values(wavesurferRefs.current).forEach(ws => {
            if (ws) ws.seekTo(progress);
        });
        setCurrentTime(progress * duration);
        isSeeking.current = false;
    }, [duration]);

    const downloadTrack = (trackId: string, label: string) => {
        const link = document.createElement("a");
        link.href = getAudioUrl(trackId);
        link.download = `${taskId}_${label.toLowerCase().replace(/\s+/g, "_")}.wav`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    const allReady = Object.values(isReady).every(r => r);

    // Determine which track each spectrogram section maps to
    const afterTrackId = mode === "extract" ? "ghost" : "clean";
    const residualTrackId = mode === "extract" ? "clean" : "ghost";

    return (
        <div
            style={{
                background: "var(--bg-secondary)",
                borderRadius: "16px",
                border: "1px solid var(--glass-border)",
                overflow: "hidden"
            }}
        >
            {/* Header */}
            <div
                style={{
                    padding: "20px 24px",
                    borderBottom: "1px solid var(--glass-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                }}
            >
                <div>
                    <h3 style={{
                        fontSize: "1rem",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        marginBottom: "4px"
                    }}>
                        ✨ Separation Complete
                    </h3>
                    <p style={{
                        fontSize: "0.8rem",
                        color: "var(--text-muted)"
                    }}>
                        "{description}"
                    </p>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                    {onUploadNew && (
                        <button
                            onClick={onUploadNew}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "8px 14px",
                                borderRadius: "8px",
                                background: "var(--bg-tertiary)",
                                color: "var(--text-secondary)",
                                border: "1px solid var(--border-color)",
                                cursor: "pointer",
                                fontSize: "0.8rem",
                                fontWeight: 500
                            }}
                        >
                            ↩ Upload New File
                        </button>
                    )}
                    <button
                        onClick={onNewSeparation}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "8px 14px",
                            borderRadius: "8px",
                            background: "var(--bg-tertiary)",
                            color: "var(--text-secondary)",
                            border: "1px solid var(--border-color)",
                            cursor: "pointer",
                            fontSize: "0.8rem",
                            fontWeight: 500
                        }}
                    >
                        <RefreshCw style={{ width: "14px", height: "14px" }} />
                        New Prompt
                    </button>
                </div>
            </div>

            {/* Stats Bar */}
            {(audioDuration || processingTime || modelSize) && (
                <div
                    style={{
                        padding: "12px 24px",
                        borderBottom: "1px solid var(--glass-border)",
                        display: "flex",
                        gap: "24px",
                        background: "var(--bg-tertiary)"
                    }}
                >
                    {audioDuration !== undefined && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                Audio:
                            </span>
                            <span style={{
                                fontSize: "0.8rem",
                                fontWeight: 600,
                                color: "var(--text-primary)",
                                fontFamily: "monospace"
                            }}>
                                {Math.floor(audioDuration / 60)}:{(audioDuration % 60).toFixed(0).padStart(2, "0")}
                            </span>
                        </div>
                    )}
                    {processingTime !== undefined && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                Processing:
                            </span>
                            <span style={{
                                fontSize: "0.8rem",
                                fontWeight: 600,
                                color: "#10B981",
                                fontFamily: "monospace"
                            }}>
                                {processingTime.toFixed(1)}s
                            </span>
                        </div>
                    )}
                    {modelSize && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                Model:
                            </span>
                            <span style={{
                                fontSize: "0.8rem",
                                fontWeight: 600,
                                color: "var(--ghost-primary)",
                                textTransform: "capitalize"
                            }}>
                                {modelSize}
                            </span>
                        </div>
                    )}
                    {audioDuration && processingTime && (
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" }}>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                Speed:
                            </span>
                            <span style={{
                                fontSize: "0.8rem",
                                fontWeight: 600,
                                color: "#F59E0B",
                                fontFamily: "monospace"
                            }}>
                                {(audioDuration / processingTime).toFixed(1)}x
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Transport Controls */}
            <div
                style={{
                    padding: "16px 24px",
                    borderBottom: "1px solid var(--glass-border)",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    background: "var(--bg-tertiary)"
                }}
            >
                <button
                    onClick={resetToStart}
                    disabled={!allReady}
                    style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "var(--bg-secondary)",
                        color: "var(--text-muted)",
                        border: "none",
                        cursor: allReady ? "pointer" : "not-allowed",
                        opacity: allReady ? 1 : 0.5
                    }}
                >
                    <SkipBack style={{ width: "14px", height: "14px" }} />
                </button>

                <button
                    onClick={togglePlayAll}
                    disabled={!allReady}
                    style={{
                        width: "40px",
                        height: "40px",
                        borderRadius: "8px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: isPlaying
                            ? "linear-gradient(135deg, var(--ghost-primary), var(--ghost-accent))"
                            : "linear-gradient(135deg, var(--ghost-primary), var(--ghost-secondary))",
                        border: "none",
                        cursor: allReady ? "pointer" : "not-allowed",
                        opacity: allReady ? 1 : 0.5,
                        boxShadow: "0 2px 8px rgba(30, 58, 95, 0.4)"
                    }}
                >
                    {isPlaying ? (
                        <Pause style={{ width: "18px", height: "18px", color: "white" }} />
                    ) : (
                        <Play style={{ width: "18px", height: "18px", color: "white", marginLeft: "2px" }} />
                    )}
                </button>

                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{
                        fontSize: "0.75rem",
                        fontFamily: "monospace",
                        color: "var(--text-muted)",
                        minWidth: "36px"
                    }}>
                        {formatTime(currentTime)}
                    </span>

                    <div
                        style={{
                            flex: 1,
                            height: "4px",
                            borderRadius: "2px",
                            background: "var(--bg-secondary)",
                            cursor: "pointer",
                            position: "relative"
                        }}
                        onClick={handleSeek}
                    >
                        <div
                            style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                height: "100%",
                                borderRadius: "2px",
                                background: "linear-gradient(90deg, var(--ghost-primary), var(--ghost-secondary))",
                                width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                                transition: "width 0.1s"
                            }}
                        />
                    </div>

                    <span style={{
                        fontSize: "0.75rem",
                        fontFamily: "monospace",
                        color: "var(--text-muted)",
                        minWidth: "36px"
                    }}>
                        {formatTime(duration)}
                    </span>
                </div>
            </div>

            {/* Tracks + Metadata Identity */}
            <div style={{
                padding: "20px 24px",
                display: "flex",
                gap: "20px",
            }}>
                {/* Left: Audio Tracks */}
                <div style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: "16px",
                    minWidth: 0,
                }}>
                    {TRACKS.map((track) => {
                        const TrackIcon = track.icon;
                        const isMuted = muted[track.id];
                        const trackReady = isReady[track.id];
                        const isSelected = selectedTrack === track.id;

                        return (
                            <div
                                key={track.id}
                                onClick={() => setSelectedTrack(track.id)}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                    padding: "14px 16px",
                                    borderRadius: "12px",
                                    background: isMuted ? "var(--bg-tertiary)" : `${track.color}08`,
                                    border: `1px solid ${isSelected ? track.color : isMuted ? "var(--border-color)" : `${track.color}30`}`,
                                    opacity: isMuted ? 0.6 : 1,
                                    transition: "all 0.2s ease",
                                    cursor: "pointer",
                                    boxShadow: isSelected ? `0 0 12px ${track.color}30` : "none",
                                    position: "relative",
                                }}
                            >
                                {/* Mute Button */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); toggleMute(track.id); }}
                                    style={{
                                        width: "32px",
                                        height: "32px",
                                        borderRadius: "8px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        background: isMuted ? "var(--bg-secondary)" : `${track.color}20`,
                                        color: isMuted ? "var(--text-muted)" : track.color,
                                        border: "none",
                                        cursor: "pointer",
                                        flexShrink: 0
                                    }}
                                >
                                    {isMuted ? (
                                        <VolumeX style={{ width: "16px", height: "16px" }} />
                                    ) : (
                                        <Volume2 style={{ width: "16px", height: "16px" }} />
                                    )}
                                </button>

                                {/* Track Label */}
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "10px",
                                    minWidth: "180px",
                                    flexShrink: 0
                                }}>
                                    <TrackIcon
                                        style={{
                                            width: "16px",
                                            height: "16px",
                                            color: isMuted ? "var(--text-muted)" : track.color
                                        }}
                                    />
                                    <span style={{
                                        fontSize: "0.85rem",
                                        fontWeight: 500,
                                        color: isMuted ? "var(--text-muted)" : "var(--text-primary)"
                                    }}>
                                        {track.label}
                                    </span>
                                    {isSelected && (
                                        <span style={{
                                            fontSize: "0.55rem",
                                            fontWeight: 700,
                                            textTransform: "uppercase" as const,
                                            letterSpacing: "0.5px",
                                            padding: "1px 6px",
                                            borderRadius: "3px",
                                            background: `${track.color}20`,
                                            color: track.color,
                                        }}>
                                            Playhead
                                        </span>
                                    )}
                                </div>

                                {/* Waveform */}
                                <div
                                    ref={(el) => { containerRefs.current[track.id] = el; }}
                                    style={{
                                        flex: 1,
                                        borderRadius: "8px",
                                        overflow: "hidden",
                                        background: "var(--bg-secondary)",
                                        minHeight: "48px"
                                    }}
                                >
                                    {!trackReady && (
                                        <div style={{
                                            height: "48px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center"
                                        }}>
                                            <span style={{
                                                fontSize: "0.75rem",
                                                color: "var(--text-muted)"
                                            }}>
                                                Loading...
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Download */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); downloadTrack(track.id, track.label); }}
                                    style={{
                                        width: "32px",
                                        height: "32px",
                                        borderRadius: "8px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        background: "var(--bg-secondary)",
                                        color: "var(--text-muted)",
                                        border: "none",
                                        cursor: "pointer",
                                        flexShrink: 0
                                    }}
                                >
                                    <Download style={{ width: "16px", height: "16px" }} />
                                </button>
                            </div>
                        );
                    })}
                </div>

                {/* Right: Audio Identity Metadata */}
                {audioMetadata && (
                    <div style={{
                        width: "260px",
                        flexShrink: 0,
                        padding: "16px",
                        borderRadius: "12px",
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--glass-border)",
                        alignSelf: "flex-start",
                    }}>
                        <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            marginBottom: "14px",
                            paddingBottom: "10px",
                            borderBottom: "1px solid var(--glass-border)",
                        }}>
                            <FileText style={{ width: "14px", height: "14px", color: "var(--ghost-primary)" }} />
                            <span style={{
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                color: "var(--text-secondary)"
                            }}>
                                Audio Identity
                            </span>
                        </div>

                        {audioMetadata.original_filename && (
                            <div style={{ marginBottom: "12px" }}>
                                <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.3px" }}>
                                    File
                                </div>
                                <div style={{
                                    fontSize: "0.75rem",
                                    color: "var(--text-primary)",
                                    fontWeight: 500,
                                    wordBreak: "break-all",
                                    lineHeight: 1.4,
                                }}>
                                    {audioMetadata.original_filename}
                                </div>
                            </div>
                        )}

                        {[
                            { label: "Format", value: audioMetadata.format ? audioMetadata.format.toUpperCase() : null },
                            { label: "Codec", value: audioMetadata.codec },
                            { label: "Sample Rate", value: audioMetadata.sample_rate ? `${audioMetadata.sample_rate} Hz` : null },
                            { label: "Channels", value: audioMetadata.channels === 1 ? "Mono" : audioMetadata.channels === 2 ? "Stereo" : audioMetadata.channels ? `${audioMetadata.channels} channels` : null },
                            { label: "Bit Depth", value: audioMetadata.bit_depth ? `${audioMetadata.bit_depth}-bit` : null },
                            { label: "File Size", value: audioMetadata.file_size_bytes ? `${(audioMetadata.file_size_bytes / (1024 * 1024)).toFixed(1)} MB` : null },
                            { label: "Duration", value: audioDuration ? `${audioDuration.toFixed(1)}s` : null },
                        ].filter(row => row.value).map(row => (
                            <div key={row.label} style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "5px 0",
                                borderBottom: "1px solid var(--glass-border)",
                            }}>
                                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                                    {row.label}
                                </span>
                                <span style={{
                                    fontSize: "0.75rem",
                                    color: "var(--text-primary)",
                                    fontWeight: 500,
                                    fontFamily: "monospace",
                                }}>
                                    {row.value}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ============================================ */}
            {/* TABS: Playback | Spectrogram | Report        */}
            {/* ============================================ */}
            <div
                style={{
                    borderTop: "1px solid var(--glass-border)",
                    borderBottom: "1px solid var(--glass-border)",
                    display: "flex",
                    background: "var(--bg-tertiary)",
                }}
            >
                {[
                    { id: "playback" as const, label: "Playback", icon: Music },
                    { id: "spectrogram" as const, label: "Spectrogram", icon: BarChart3 },
                    { id: "report" as const, label: "Report", icon: FileText },
                ].map((tab) => {
                    const TabIcon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                flex: 1,
                                padding: "12px 16px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "6px",
                                background: isActive ? "var(--bg-secondary)" : "transparent",
                                border: "none",
                                borderBottom: isActive ? "2px solid var(--ghost-primary)" : "2px solid transparent",
                                cursor: "pointer",
                                color: isActive ? "var(--ghost-primary)" : "var(--text-muted)",
                                fontWeight: isActive ? 600 : 400,
                                fontSize: "0.8rem",
                                transition: "all 0.2s",
                            }}
                        >
                            <TabIcon style={{ width: "14px", height: "14px" }} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Tab Content: Spectrogram */}
            {activeTab === "spectrogram" && (
                <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--glass-border)" }}>
                    {/* Header with track selector */}
                    <div style={{ marginBottom: "16px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                            <h4 style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
                                Spectral Comparison
                            </h4>
                            {/* Track selector buttons - pick which spectrogram gets the playhead */}
                            <div style={{ display: "flex", gap: "6px" }}>
                                {TRACKS.map((t) => {
                                    const TIcon = t.icon;
                                    const isActive = selectedTrack === t.id;
                                    return (
                                        <button
                                            key={t.id}
                                            onClick={() => setSelectedTrack(t.id)}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "4px",
                                                padding: "3px 10px",
                                                borderRadius: "6px",
                                                background: isActive ? `${t.color}20` : "var(--bg-tertiary)",
                                                border: `1px solid ${isActive ? t.color : "var(--glass-border)"}`,
                                                color: isActive ? t.color : "var(--text-muted)",
                                                cursor: "pointer",
                                                fontSize: "0.65rem",
                                                fontWeight: isActive ? 700 : 400,
                                                transition: "all 0.2s",
                                                boxShadow: isActive ? `0 0 8px ${t.color}25` : "none",
                                            }}
                                        >
                                            <TIcon style={{ width: "10px", height: "10px" }} />
                                            {t.id === "original" ? "Original" : t.id === "ghost" ? "Isolated" : "Residual"}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: 0 }}>
                            Compare the frequency spectrum before and after restoration.
                            {mode === "extract"
                                ? " The content matching your intent was isolated and extracted."
                                : " The content matching your intent was removed."}
                            {" Select a track above to show the playhead on its spectrogram."}
                        </p>
                    </div>

                    {/* Before: Original */}
                    <div style={{ marginBottom: "16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                            <span style={{
                                fontSize: "0.65rem",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                background: selectedTrack === "original" ? "rgba(245, 158, 11, 0.25)" : "rgba(245, 158, 11, 0.15)",
                                color: "#F59E0B",
                                boxShadow: selectedTrack === "original" ? "0 0 8px rgba(245, 158, 11, 0.2)" : "none",
                                transition: "all 0.2s",
                            }}>
                                BEFORE
                            </span>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                Original Audio — full frequency content before processing
                            </span>
                            {selectedTrack === "original" && (
                                <span style={{ fontSize: "0.6rem", color: "#F59E0B", fontWeight: 600 }}>
                                    ▸ Playhead Active
                                </span>
                            )}
                        </div>
                        <SpectralAnalyzer
                            taskId={taskId}
                            track="original"
                            audioUrl={getAudioUrl("original")}
                            height={180}
                            colorScheme="fire"
                            playbackTime={selectedTrack === "original" ? currentTime : 0}
                            isPlaying={selectedTrack === "original" ? isPlaying : false}
                            audioDuration={selectedTrack === "original" ? duration : 0}
                        />
                    </div>

                    {/* After: Result of separation */}
                    <div style={{ marginBottom: "16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                            <span style={{
                                fontSize: "0.65rem",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                background: selectedTrack === afterTrackId ? "rgba(16, 185, 129, 0.25)" : "rgba(16, 185, 129, 0.15)",
                                color: "#10B981",
                                boxShadow: selectedTrack === afterTrackId ? "0 0 8px rgba(16, 185, 129, 0.2)" : "none",
                                transition: "all 0.2s",
                            }}>
                                AFTER
                            </span>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                {mode === "extract"
                                    ? `Isolated Sound — "${description}" extracted, free from noise`
                                    : `Restored Audio — after removing "${description}"`
                                }
                            </span>
                            {selectedTrack === afterTrackId && (
                                <span style={{ fontSize: "0.6rem", color: "#10B981", fontWeight: 600 }}>
                                    ▸ Playhead Active
                                </span>
                            )}
                        </div>
                        <SpectralAnalyzer
                            taskId={taskId}
                            track={afterTrackId}
                            audioUrl={getAudioUrl(afterTrackId)}
                            height={180}
                            colorScheme="fire"
                            playbackTime={selectedTrack === afterTrackId ? currentTime : 0}
                            isPlaying={selectedTrack === afterTrackId ? isPlaying : false}
                            audioDuration={selectedTrack === afterTrackId ? duration : 0}
                        />
                    </div>

                    {/* Residual/Removed */}
                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                            <span style={{
                                fontSize: "0.65rem",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                padding: "2px 8px",
                                borderRadius: "4px",
                                background: selectedTrack === residualTrackId ? "rgba(244, 114, 182, 0.25)" : "rgba(244, 114, 182, 0.15)",
                                color: "#F472B6",
                                boxShadow: selectedTrack === residualTrackId ? "0 0 8px rgba(244, 114, 182, 0.2)" : "none",
                                transition: "all 0.2s",
                            }}>
                                {mode === "extract" ? "RESIDUAL" : "REMOVED"}
                            </span>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                {mode === "extract"
                                    ? `Remaining audio after isolating "${description}"`
                                    : `Content removed by AI`
                                }
                            </span>
                            {selectedTrack === residualTrackId && (
                                <span style={{ fontSize: "0.6rem", color: "#F472B6", fontWeight: 600 }}>
                                    ▸ Playhead Active
                                </span>
                            )}
                        </div>
                        <SpectralAnalyzer
                            taskId={taskId}
                            track={residualTrackId}
                            audioUrl={getAudioUrl(residualTrackId)}
                            height={100}
                            colorScheme="cool"
                            compact
                            playbackTime={selectedTrack === residualTrackId ? currentTime : 0}
                            isPlaying={selectedTrack === residualTrackId ? isPlaying : false}
                            audioDuration={selectedTrack === residualTrackId ? duration : 0}
                        />
                    </div>

                    {/* How to read spectrogram legend */}
                    <div style={{
                        marginTop: "12px",
                        padding: "14px 16px",
                        borderRadius: "8px",
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--glass-border)",
                        fontSize: "0.75rem",
                        color: "var(--text-secondary)",
                        lineHeight: 1.6,
                    }}>
                        <div style={{ fontWeight: 600, marginBottom: "8px", color: "var(--text-primary)", fontSize: "0.75rem" }}>
                            How to read this spectrogram
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                                    <span style={{
                                        display: "inline-block", width: "14px", height: "14px",
                                        borderRadius: "3px", background: "#F59E0B",
                                        border: "1px solid rgba(255,255,255,0.3)",
                                    }} />
                                    <span style={{ fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", color: "#F59E0B" }}>
                                        Before
                                    </span>
                                    <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                                        = Original audio (full sound)
                                    </span>
                                </span>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                                    <span style={{
                                        display: "inline-block", width: "14px", height: "14px",
                                        borderRadius: "3px", background: "#10B981",
                                        border: "1px solid rgba(255,255,255,0.3)",
                                    }} />
                                    <span style={{ fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", color: "#10B981" }}>
                                        After
                                    </span>
                                    <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                                        = Restored result (after AI processing)
                                    </span>
                                </span>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                                    <span style={{
                                        display: "inline-block", width: "14px", height: "14px",
                                        borderRadius: "3px", background: "#F472B6",
                                        border: "1px solid rgba(255,255,255,0.3)",
                                    }} />
                                    <span style={{ fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", color: "#F472B6" }}>
                                        {mode === "extract" ? "Residual" : "Removed"}
                                    </span>
                                    <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
                                        = Content the AI {mode === "extract" ? "extracted" : "removed"}
                                    </span>
                                </span>
                            </div>
                        </div>

                        <div style={{
                            marginTop: "10px",
                            padding: "10px 12px",
                            borderRadius: "6px",
                            background: "var(--bg-secondary)",
                            display: "flex",
                            flexDirection: "column",
                            gap: "5px",
                        }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                                <span style={{ color: "#F59E0B", fontSize: "0.8rem", flexShrink: 0 }}>1</span>
                                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                                    <strong style={{ color: "var(--text-secondary)" }}>Vertical axis (Y)</strong> = Sound pitch —
                                    <strong> bottom</strong> = low/deep sounds (bass, hum),
                                    <strong> top</strong> = high/piercing sounds (hiss, treble)
                                </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                                <span style={{ color: "#10B981", fontSize: "0.8rem", flexShrink: 0 }}>2</span>
                                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                                    <strong style={{ color: "var(--text-secondary)" }}>Horizontal axis (X)</strong> = Time —
                                    left = start, right = end of audio
                                </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                                <span style={{ color: "#F472B6", fontSize: "0.8rem", flexShrink: 0 }}>3</span>
                                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                                    <strong style={{ color: "var(--text-secondary)" }}>Color brightness</strong> = Sound energy —
                                    dark = quiet/empty, bright = loud/active
                                </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                                <span style={{ color: "#60A5FA", fontSize: "0.8rem", flexShrink: 0 }}>4</span>
                                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                                    <strong style={{ color: "var(--text-secondary)" }}>White line</strong> = Playhead —
                                    shows current playback position on the selected track
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Tab Content: Playback */}
            {activeTab === "playback" && (
                <div style={{
                    padding: "20px 24px",
                    fontSize: "0.8rem",
                    color: "var(--text-muted)",
                    textAlign: "center",
                }}>
                    <p>Use the transport controls and track rows above to play, mute, and download audio.</p>
                    <p style={{ fontSize: "0.7rem", marginTop: "8px" }}>
                        Click a track row to select it for the spectrogram playhead.
                    </p>
                </div>
            )}

            {/* Tab Content: Report */}
            {activeTab === "report" && (
                <RestorationReport
                    description={description}
                    audioDuration={audioDuration ?? 0}
                    processingTime={processingTime ?? 0}
                    modelSize={modelSize ?? ""}
                    mode={mode}
                    chunkDuration={chunkDuration}
                    useFloat32={useFloat32}
                />
            )}
        </div>
    );
}
