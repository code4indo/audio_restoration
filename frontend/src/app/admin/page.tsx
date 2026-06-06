"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Server, HardDrive, CheckCircle, XCircle, RefreshCw } from "lucide-react";

interface SnapshotInfo {
    snapshot_id: string;
    size_bytes: number;
}

interface ModelInfo {
    id: string;
    repo: string;
    exists: boolean;
    size_bytes: number;
    size_human: string;
    snapshots: SnapshotInfo[];
}

interface AdminData {
    authenticated: boolean;
    models: ModelInfo[];
}

function formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = bytes;
    for (const unit of units) {
        if (v < 1024) return `${v.toFixed(1)} ${unit}`;
        v /= 1024;
    }
    return `${v.toFixed(1)} PB`;
}

export default function AdminPage() {
    const [data, setData] = useState<AdminData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const fetchStatus = async () => {
        setLoading(true);
        setError("");
        try {
            const res = await fetch("/api/admin/models");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json: AdminData = await res.json();
            setData(json);
        } catch (e) {
            setError("Gagal memuat data admin: " + (e instanceof Error ? e.message : String(e)));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchStatus();
    }, []);

    return (
        <div style={{ minHeight: "100vh", background: "var(--bg-primary)" }}>
            {/* Simple header */}
            <header
                style={{
                    borderBottom: "1px solid var(--glass-border)",
                    background: "var(--bg-secondary)",
                }}
            >
                <div
                    style={{
                        maxWidth: "1200px",
                        margin: "0 auto",
                        padding: "16px 24px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <a
                            href="/"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                color: "var(--text-muted)",
                                textDecoration: "none",
                                fontSize: "0.875rem",
                                padding: "6px 12px",
                                borderRadius: "8px",
                                background: "var(--bg-tertiary)",
                            }}
                        >
                            <ArrowLeft style={{ width: "14px", height: "14px" }} />
                            Kembali
                        </a>
                        <Server style={{ width: "20px", height: "20px", color: "var(--ghost-primary)" }} />
                        <h1 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
                            Admin Panel
                        </h1>
                    </div>
                    <button
                        onClick={fetchStatus}
                        disabled={loading}
                        style={{
                            padding: "8px 14px",
                            borderRadius: "8px",
                            background: "var(--bg-tertiary)",
                            color: "var(--text-secondary)",
                            border: "none",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "0.875rem",
                        }}
                    >
                        <RefreshCw style={{ width: "14px", height: "14px", animation: loading ? "spin 1s linear infinite" : "none" }} />
                        Refresh
                    </button>
                </div>
            </header>

            {/* Content */}
            <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>
                {/* Connection status */}
                {data && (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            padding: "16px 20px",
                            borderRadius: "12px",
                            border: "1px solid var(--glass-border)",
                            background: "var(--bg-secondary)",
                            marginBottom: "24px",
                        }}
                    >
                        <div
                            style={{
                                width: "10px",
                                height: "10px",
                                borderRadius: "50%",
                                background: data.authenticated ? "var(--ghost-success)" : "var(--ghost-error)",
                                flexShrink: 0,
                            }}
                        />
                        <span style={{ fontSize: "0.9rem", color: "var(--text-primary)", fontWeight: 500 }}>
                            HuggingFace: {data.authenticated ? "Terautentikasi" : "Tidak terautentikasi"}
                        </span>
                        {data.authenticated && (
                            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                                — Token valid, akses model tersedia
                            </span>
                        )}
                    </div>
                )}

                {/* Model table */}
                <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "12px" }}>
                    <HardDrive style={{ width: "16px", height: "16", display: "inline", marginRight: "8px", verticalAlign: "middle" }} />
                    Ketersediaan Model SAM Audio
                </h2>

                {loading && !data && (
                    <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)" }}>
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
                        Memuat data...
                    </div>
                )}

                {error && (
                    <div
                        style={{
                            padding: "16px",
                            borderRadius: "8px",
                            background: "rgba(166, 60, 60, 0.1)",
                            border: "1px solid rgba(166, 60, 60, 0.3)",
                            color: "var(--ghost-error)",
                        }}
                    >
                        {error}
                    </div>
                )}

                {data && (
                    <div style={{ overflowX: "auto" }}>
                        <table
                            style={{
                                width: "100%",
                                borderCollapse: "collapse",
                                fontSize: "0.875rem",
                            }}
                        >
                            <thead>
                                <tr
                                    style={{
                                        background: "var(--bg-tertiary)",
                                        borderBottom: "1px solid var(--glass-border)",
                                    }}
                                >
                                    <th style={{ padding: "12px 16px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600 }}>Model</th>
                                    <th style={{ padding: "12px 16px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600 }}>Repo ID</th>
                                    <th style={{ padding: "12px 16px", textAlign: "center", color: "var(--text-muted)", fontWeight: 600 }}>Status</th>
                                    <th style={{ padding: "12px 16px", textAlign: "right", color: "var(--text-muted)", fontWeight: 600 }}>Ukuran</th>
                                    <th style={{ padding: "12px 16px", textAlign: "left", color: "var(--text-muted)", fontWeight: 600 }}>Snapshot</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.models.map((model) => (
                                    <tr
                                        key={model.id}
                                        style={{
                                            borderBottom: "1px solid var(--glass-border)",
                                            background: "var(--bg-primary)",
                                        }}
                                    >
                                        <td style={{ padding: "14px 16px", fontWeight: 600, color: "var(--text-primary)" }}>
                                            <span
                                                style={{
                                                    display: "inline-block",
                                                    padding: "2px 10px",
                                                    borderRadius: "6px",
                                                    fontSize: "0.75rem",
                                                    fontWeight: 700,
                                                    textTransform: "uppercase",
                                                    letterSpacing: "0.5px",
                                                    background: model.id === "base"
                                                        ? "rgba(30, 58, 95, 0.15)"
                                                        : model.id === "large"
                                                        ? "rgba(184, 134, 11, 0.15)"
                                                        : model.id === "judge"
                                                        ? "rgba(128, 90, 213, 0.15)"
                                                        : "rgba(16, 185, 129, 0.15)",
                                                    color: model.id === "base"
                                                        ? "var(--ghost-primary)"
                                                        : model.id === "large"
                                                        ? "var(--ghost-accent)"
                                                        : model.id === "judge"
                                                        ? "#8B5CF6"
                                                        : "var(--ghost-success)",
                                                }}
                                            >
                                                {model.id}
                                            </span>
                                        </td>
                                        <td style={{ padding: "14px 16px", color: "var(--text-secondary)", fontFamily: "monospace", fontSize: "0.8rem" }}>
                                            {model.repo}
                                        </td>
                                        <td style={{ padding: "14px 16px", textAlign: "center" }}>
                                            {model.exists ? (
                                                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--ghost-success)", fontWeight: 500 }}>
                                                    <CheckCircle style={{ width: "16px", height: "16px" }} />
                                                    Tersedia
                                                </span>
                                            ) : (
                                                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--ghost-error)", fontWeight: 500 }}>
                                                    <XCircle style={{ width: "16px", height: "16px" }} />
                                                    Tidak ada
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ padding: "14px 16px", textAlign: "right", color: "var(--text-primary)", fontFamily: "monospace" }}>
                                            {model.size_human}
                                        </td>
                                        <td style={{ padding: "14px 16px" }}>
                                            {model.snapshots.length > 0 ? (
                                                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                                    {model.snapshots.map((s) => (
                                                        <span
                                                            key={s.snapshot_id}
                                                            style={{
                                                                fontSize: "0.7rem",
                                                                fontFamily: "monospace",
                                                                color: "var(--text-muted)",
                                                            }}
                                                            title={`${s.snapshot_id} — ${formatBytes(s.size_bytes)}`}
                                                        >
                                                            {s.snapshot_id.substring(0, 12)}... ({formatBytes(s.size_bytes)})
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Info box */}
                <div
                    style={{
                        marginTop: "24px",
                        padding: "16px 20px",
                        borderRadius: "12px",
                        border: "1px solid var(--glass-border)",
                        background: "var(--bg-secondary)",
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                        lineHeight: 1.6,
                    }}
                >
                    <strong style={{ color: "var(--text-secondary)" }}>Lokasi penyimpanan:</strong>{" "}
                    <code style={{ background: "var(--bg-tertiary)", padding: "2px 6px", borderRadius: "4px" }}>
                        ~/.cache/huggingface/hub/
                    </code>
                    <br />
                    Halaman ini membaca data langsung dari HuggingFace Hub cache. Jika model tidak terdeteksi padahal sudah di-download, periksa apakah path cache sesuai.
                </div>
            </div>

            {/* Inject animation keyframes */}
            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}} />
        </div>
    );
}
