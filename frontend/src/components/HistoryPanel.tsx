"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { X, Music, Video, Clock, Mic, RefreshCw, Trash2, AlertTriangle, Download, Play, Pause } from "lucide-react";

interface HistoryResult {
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
}

interface HistoryItem {
    task_id: string;
    created_at: string;
    description: string;
    mode: string;
    model_size: string;
    audio_duration: number;
    processing_time: number;
    original_filename: string;
    result: HistoryResult;
}

interface HistoryPanelProps {
    onClose: () => void;
    onRestore: (taskId: string, result: HistoryResult) => void;
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatDuration(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function HistoryPanel({ onClose, onRestore }: HistoryPanelProps) {
    const [items, setItems] = useState<HistoryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [playingTaskId, setPlayingTaskId] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const fetchHistory = async () => {
        setIsLoading(true);
        setError("");
        try {
            const res = await fetch("/api/tasks/history");
            if (!res.ok) throw new Error("Failed to load history");
            const data = await res.json();
            setItems(data);
        } catch (e) {
            setError("Gagal memuat riwayat restorasi");
        } finally {
            setIsLoading(false);
        }
    };

    const downloadOriginal = (taskId: string, filename: string) => {
        const a = document.createElement("a");
        a.href = `/api/tasks/${taskId}/download/original`;
        a.download = filename || "original.wav";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const togglePlayOriginal = (taskId: string) => {
        if (playingTaskId === taskId) {
            // Stop current playback
            audioRef.current?.pause();
            audioRef.current = null;
            setPlayingTaskId(null);
        } else {
            // Stop previous if any
            audioRef.current?.pause();
            const audio = new Audio(`/outputs/${taskId}.original.wav`);
            audio.onended = () => {
                setPlayingTaskId(null);
                audioRef.current = null;
            };
            audio.onerror = () => {
                setPlayingTaskId(null);
                audioRef.current = null;
            };
            audio.play();
            audioRef.current = audio;
            setPlayingTaskId(taskId);
        }
    };

    const handleDelete = async (taskId: string) => {
        setDeleting(taskId);
        try {
            // Cancel the task if still running
            await fetch(`/api/tasks/${taskId}`, { method: "DELETE" }).catch(() => {});

            // Delete from history
            const res = await fetch(`/api/tasks/${taskId}/history`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to delete");

            // Remove from list
            setItems(items.filter(item => item.task_id !== taskId));
            setDeleteConfirm(null);
        } catch (e) {
            alert("Gagal menghapus riwayat");
        } finally {
            setDeleting(null);
        }
    };

    useEffect(() => {
        fetchHistory();
        return () => {
            audioRef.current?.pause();
            audioRef.current = null;
        };
    }, []);

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(0,0,0,0.6)",
                    backdropFilter: "blur(4px)",
                    zIndex: 99,
                }}
            />

            {/* Drawer */}
            <div
                style={{
                    position: "fixed",
                    top: 0,
                    right: 0,
                    height: "100vh",
                    width: "min(480px, 95vw)",
                    background: "var(--bg-secondary)",
                    borderLeft: "1px solid var(--glass-border)",
                    zIndex: 100,
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: "-8px 0 40px rgba(0,0,0,0.4)",
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: "20px 24px",
                        borderBottom: "1px solid var(--glass-border)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexShrink: 0,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <Clock style={{ width: "20px", height: "20px", color: "var(--ghost-primary)" }} />
                        <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
                            Riwayat Restorasi
                        </h2>
                        {items.length > 0 && (
                            <span
                                style={{
                                    fontSize: "0.75rem",
                                    padding: "2px 8px",
                                    borderRadius: "12px",
                                    background: "var(--bg-tertiary)",
                                    color: "var(--text-muted)",
                                }}
                            >
                                {items.length}
                            </span>
                        )}
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                        <button
                            onClick={fetchHistory}
                            title="Refresh"
                            style={{
                                padding: "6px",
                                borderRadius: "8px",
                                background: "var(--bg-tertiary)",
                                border: "none",
                                cursor: "pointer",
                                color: "var(--text-muted)",
                                display: "flex",
                                alignItems: "center",
                            }}
                        >
                            <RefreshCw style={{ width: "14px", height: "14px" }} />
                        </button>
                        <button
                            onClick={onClose}
                            style={{
                                padding: "6px",
                                borderRadius: "8px",
                                background: "var(--bg-tertiary)",
                                border: "none",
                                cursor: "pointer",
                                color: "var(--text-muted)",
                                display: "flex",
                                alignItems: "center",
                            }}
                        >
                            <X style={{ width: "16px", height: "16px" }} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
                    {isLoading ? (
                        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
                            <div
                                style={{
                                    width: "32px",
                                    height: "32px",
                                    border: "3px solid var(--bg-tertiary)",
                                    borderTop: "3px solid var(--ghost-primary)",
                                    borderRadius: "50%",
                                    margin: "0 auto 16px",
                                    animation: "spin 1s linear infinite",
                                }}
                            />
                            Memuat riwayat...
                        </div>
                    ) : error ? (
                        <div style={{ textAlign: "center", padding: "48px 0" }}>
                            <p style={{ color: "var(--ghost-error)", marginBottom: "12px" }}>{error}</p>
                            <button className="btn-primary" onClick={fetchHistory}>Coba Lagi</button>
                        </div>
                    ) : items.length === 0 ? (
                        <div style={{ textAlign: "center", padding: "64px 24px", color: "var(--text-muted)" }}>
                            <Clock style={{ width: "40px", height: "40px", margin: "0 auto 16px", opacity: 0.3 }} />
                            <p style={{ fontSize: "0.95rem" }}>Belum ada riwayat restorasi</p>
                            <p style={{ fontSize: "0.8rem", marginTop: "8px", opacity: 0.7 }}>
                                Hasil restorasi akan muncul di sini setelah proses selesai
                            </p>
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                            {items.map((item) => (
                                <div
                                    key={item.task_id}
                                    style={{
                                        width: "100%",
                                        padding: "14px 16px",
                                        borderRadius: "12px",
                                        border: "1px solid var(--glass-border)",
                                        background: "var(--bg-primary)",
                                        transition: "all 0.2s ease",
                                        position: "relative",
                                    }}
                                    onMouseOver={(e) => {
                                        e.currentTarget.style.background = "var(--bg-tertiary)";
                                        e.currentTarget.style.borderColor = "var(--ghost-primary)";
                                    }}
                                    onMouseOut={(e) => {
                                        e.currentTarget.style.background = "var(--bg-primary)";
                                        e.currentTarget.style.borderColor = "var(--glass-border)";
                                    }}
                                >
                                    <div
                                        onClick={() => {
                                            onRestore(item.task_id, item.result);
                                            onClose();
                                        }}
                                        style={{
                                            width: "100%",
                                            textAlign: "left",
                                            background: "transparent",
                                            border: "none",
                                            cursor: "pointer",
                                            padding: 0,
                                        }}
                                    >
                                    {/* Row 1: icon + filename + type badge */}
                                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                                        <div
                                            style={{
                                                width: "34px",
                                                height: "34px",
                                                borderRadius: "8px",
                                                flexShrink: 0,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                background: item.result.is_video
                                                    ? "linear-gradient(135deg, #F59E0B, #EF4444)"
                                                    : "linear-gradient(135deg, var(--ghost-primary), var(--ghost-accent))",
                                            }}
                                        >
                                            {item.result.is_video
                                                ? <Video style={{ width: "16px", height: "16px", color: "white" }} />
                                                : <Music style={{ width: "16px", height: "16px", color: "white" }} />
                                            }
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <p
                                                style={{
                                                    fontSize: "0.85rem",
                                                    fontWeight: 600,
                                                    color: "var(--text-primary)",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap",
                                                    margin: 0,
                                                }}
                                            >
                                                {item.original_filename || "audio file"}
                                            </p>
                                            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
                                                {formatDate(item.created_at)}
                                            </p>
                                        </div>
                                        <span
                                            style={{
                                                fontSize: "0.7rem",
                                                padding: "3px 8px",
                                                borderRadius: "8px",
                                                flexShrink: 0,
                                                background: item.mode === "extract"
                                                    ? "rgba(16,185,129,0.15)"
                                                    : "rgba(239,68,68,0.15)",
                                                color: item.mode === "extract"
                                                    ? "var(--ghost-success)"
                                                    : "var(--ghost-error)",
                                                border: `1px solid ${item.mode === "extract" ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
                                            }}
                                        >
                                            {item.mode === "extract" ? "Extract" : "Remove"}
                                        </span>
                                    </div>

                                    {/* Row 2: description */}
                                    <div style={{ display: "flex", alignItems: "flex-start", gap: "6px", marginBottom: "8px" }}>
                                        <Mic style={{ width: "12px", height: "12px", color: "var(--ghost-primary)", marginTop: "2px", flexShrink: 0 }} />
                                        <p
                                            style={{
                                                fontSize: "0.8rem",
                                                color: "var(--text-secondary)",
                                                margin: 0,
                                                fontStyle: "italic",
                                                overflow: "hidden",
                                                display: "-webkit-box",
                                                WebkitLineClamp: 2,
                                                WebkitBoxOrient: "vertical",
                                            } as React.CSSProperties}
                                        >
                                            "{item.description}"
                                        </p>
                                    </div>

                                    {/* Row 3: stats + actions */}
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <div style={{ display: "flex", gap: "12px" }}>
                                            {item.audio_duration > 0 && (
                                                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                                                    ⏱ {formatDuration(item.audio_duration)}
                                                </span>
                                            )}
                                            {item.processing_time > 0 && (
                                                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                                                    ⚡ {formatDuration(item.processing_time)}
                                                </span>
                                            )}
                                            {item.model_size && (
                                                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                                                    🤖 {item.model_size}
                                                </span>
                                            )}
                                        </div>

                                        {/* Action buttons */}
                                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                            {/* Play Original button */}
                                            {!item.result.is_video && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); togglePlayOriginal(item.task_id); }}
                                                    title={playingTaskId === item.task_id ? "Pause original" : "Play original"}
                                                    style={{
                                                        padding: "6px 10px",
                                                        borderRadius: "6px",
                                                        border: "1px solid rgba(16, 185, 129, 0.3)",
                                                        background: playingTaskId === item.task_id
                                                            ? "rgba(16, 185, 129, 0.2)"
                                                            : "rgba(16, 185, 129, 0.1)",
                                                        color: playingTaskId === item.task_id
                                                            ? "#34d399"
                                                            : "#10b981",
                                                        cursor: "pointer",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: "4px",
                                                        fontSize: "0.75rem",
                                                        fontWeight: 500,
                                                        transition: "all 0.2s ease",
                                                    }}
                                                    onMouseOver={(e) => {
                                                        e.currentTarget.style.background = "#10b981";
                                                        e.currentTarget.style.color = "white";
                                                        e.currentTarget.style.borderColor = "#10b981";
                                                    }}
                                                    onMouseOut={(e) => {
                                                        e.currentTarget.style.background = playingTaskId === item.task_id
                                                            ? "rgba(16, 185, 129, 0.2)"
                                                            : "rgba(16, 185, 129, 0.1)";
                                                        e.currentTarget.style.color = playingTaskId === item.task_id
                                                            ? "#34d399"
                                                            : "#10b981";
                                                        e.currentTarget.style.borderColor = "rgba(16, 185, 129, 0.3)";
                                                    }}
                                                >
                                                    {playingTaskId === item.task_id
                                                        ? <Pause style={{ width: "12px", height: "12px" }} />
                                                        : <Play style={{ width: "12px", height: "12px" }} />
                                                    }
                                                </button>
                                            )}

                                            {/* Download Original button */}
                                            <button
                                                onClick={(e) => { e.stopPropagation(); downloadOriginal(item.task_id, item.original_filename); }}
                                                title="Download file original"
                                                style={{
                                                    padding: "6px 10px",
                                                    borderRadius: "6px",
                                                    border: "1px solid rgba(99, 102, 241, 0.3)",
                                                    background: "rgba(99, 102, 241, 0.1)",
                                                    color: "#818cf8",
                                                    cursor: "pointer",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "4px",
                                                    fontSize: "0.75rem",
                                                    fontWeight: 500,
                                                    transition: "all 0.2s ease",
                                                }}
                                                onMouseOver={(e) => {
                                                    e.currentTarget.style.background = "#6366f1";
                                                    e.currentTarget.style.color = "white";
                                                    e.currentTarget.style.borderColor = "#6366f1";
                                                }}
                                                onMouseOut={(e) => {
                                                    e.currentTarget.style.background = "rgba(99, 102, 241, 0.1)";
                                                    e.currentTarget.style.color = "#818cf8";
                                                    e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.3)";
                                                }}
                                            >
                                                <Download style={{ width: "12px", height: "12px" }} />
                                                Original
                                            </button>

                                            {/* Delete button */}
                                            {deleteConfirm === item.task_id ? (
                                                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                                                    <span style={{ fontSize: "0.7rem", color: "var(--ghost-error)" }}>Yakin?</span>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleDelete(item.task_id); }}
                                                        disabled={deleting === item.task_id}
                                                        style={{
                                                            padding: "4px 10px",
                                                            borderRadius: "6px",
                                                            border: "1px solid var(--ghost-error)",
                                                            background: "var(--ghost-error)",
                                                            color: "white",
                                                            fontSize: "0.75rem",
                                                            fontWeight: 600,
                                                            cursor: deleting === item.task_id ? "not-allowed" : "pointer",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: "4px",
                                                            transition: "all 0.2s ease",
                                                        }}
                                                    >
                                                        {deleting === item.task_id ? "Menghapus..." : "Hapus"}
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}
                                                        style={{
                                                            padding: "4px 10px",
                                                            borderRadius: "6px",
                                                            border: "1px solid var(--glass-border)",
                                                            background: "var(--bg-tertiary)",
                                                            color: "var(--text-muted)",
                                                            fontSize: "0.75rem",
                                                            cursor: "pointer",
                                                            transition: "all 0.2s ease",
                                                        }}
                                                    >
                                                        Batal
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(item.task_id); }}
                                                    title="Hapus riwayat"
                                                    style={{
                                                        padding: "6px 10px",
                                                        borderRadius: "6px",
                                                        border: "1px solid rgba(166, 60, 60, 0.3)",
                                                        background: "rgba(166, 60, 60, 0.1)",
                                                        color: "var(--ghost-error)",
                                                        cursor: "pointer",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: "4px",
                                                        fontSize: "0.75rem",
                                                        fontWeight: 500,
                                                        transition: "all 0.2s ease",
                                                    }}
                                                    onMouseOver={(e) => {
                                                        e.currentTarget.style.background = "var(--ghost-error)";
                                                        e.currentTarget.style.color = "white";
                                                        e.currentTarget.style.borderColor = "var(--ghost-error)";
                                                    }}
                                                    onMouseOut={(e) => {
                                                        e.currentTarget.style.background = "rgba(166, 60, 60, 0.1)";
                                                        e.currentTarget.style.color = "var(--ghost-error)";
                                                        e.currentTarget.style.borderColor = "rgba(166, 60, 60, 0.3)";
                                                    }}
                                                >
                                                    <Trash2 style={{ width: "12px", height: "12px" }} />
                                                    Hapus
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
