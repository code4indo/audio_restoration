"use client";

import { useMemo } from "react";
import { Clock, Cpu, BarChart3, Download, FileText, Zap, Mic, CheckCircle } from "lucide-react";

interface RestorationReportProps {
    description: string;
    mode: "extract" | "remove";
    modelSize: string;
    audioDuration: number;
    processingTime: number;
    chunkDuration: number;
    useFloat32: boolean;
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatTimePrecise(seconds: number): string {
    if (seconds < 120) return `${seconds.toFixed(1)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs.toFixed(0)}s`;
}

export default function RestorationReport({
    description,
    mode,
    modelSize,
    audioDuration,
    processingTime,
    chunkDuration,
    useFloat32,
}: RestorationReportProps) {
    const metrics = useMemo(() => {
        const rtf = audioDuration > 0 ? processingTime / audioDuration : 0;
        const speedup = audioDuration > 0 ? audioDuration / processingTime : 0;
        const efficiency = rtf > 0 ? Math.min(1, 0.7 / rtf) : 0;

        return {
            rtf,
            speedup,
            efficiency,
            isRealtime: rtf <= 1,
            quality: useFloat32 ? "High (float32)" : "Standard (float16)",
        };
    }, [audioDuration, processingTime, useFloat32]);

    const handleExportReport = () => {
        const report = `=== Audio Restoration Report ===
Generated: ${new Date().toLocaleString()}

--- Intent ---
Description: "${description}"
Mode: ${mode}
Model: sam-audio-${modelSize}

--- Performance ---
Audio Duration: ${formatTime(audioDuration)}
Processing Time: ${formatTimePrecise(processingTime)}
Real-Time Factor (RTF): ${metrics.rtf.toFixed(3)}
Speed: ${metrics.speedup.toFixed(1)}x real-time
${metrics.isRealtime ? "✅ Processes faster than real-time" : "⚠️ Processes slower than real-time"}

--- Settings ---
Model Size: ${modelSize}
Chunk Duration: ${chunkDuration}s
Precision: ${metrics.quality}
Channels: Stereo (2)

--- AI Engine ---
Architecture: Flow-Matching Diffusion Transformer
Framework: SAM Audio (Facebook Research)
Type: Generative Universal Source Separation
`;

        const blob = new Blob([report], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `restoration-report-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div
            style={{
                background: "var(--bg-secondary)",
                borderRadius: "16px",
                border: "1px solid var(--glass-border)",
                overflow: "hidden",
            }}
        >
            {/* Header */}
            <div
                style={{
                    padding: "16px 20px",
                    borderBottom: "1px solid var(--glass-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <BarChart3 style={{ width: "16px", height: "16px", color: "var(--ghost-primary)" }} />
                    <h3 style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
                        Restoration Report
                    </h3>
                </div>
                <button
                    onClick={handleExportReport}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "6px 12px",
                        borderRadius: "8px",
                        background: "var(--bg-tertiary)",
                        color: "var(--text-secondary)",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                        fontWeight: 500,
                    }}
                >
                    <Download style={{ width: "12px", height: "12px" }} />
                    Export Report
                </button>
            </div>

            <div style={{ padding: "20px" }}>
                {/* Intent Summary */}
                <div
                    style={{
                        padding: "14px 16px",
                        borderRadius: "10px",
                        background: "linear-gradient(135deg, rgba(168, 85, 247, 0.08), rgba(244, 114, 182, 0.08))",
                        border: "1px solid rgba(168, 85, 247, 0.2)",
                        marginBottom: "20px",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                        <Mic style={{ width: "16px", height: "16px", color: "var(--ghost-primary)", marginTop: "2px", flexShrink: 0 }} />
                        <div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "2px" }}>
                                Intent Description
                            </div>
                            <div style={{ fontSize: "0.9rem", fontWeight: 500, color: "var(--text-primary)", fontStyle: "italic" }}>
                                &ldquo;{description}&rdquo;
                            </div>
                            <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                                <span
                                    style={{
                                        fontSize: "0.65rem",
                                        padding: "2px 10px",
                                        borderRadius: "10px",
                                        fontWeight: 600,
                                        textTransform: "uppercase",
                                        background: mode === "extract"
                                            ? "rgba(16, 185, 129, 0.15)"
                                            : "rgba(239, 68, 68, 0.15)",
                                        color: mode === "extract" ? "var(--ghost-success)" : "var(--ghost-error)",
                                    }}
                                >
                                    {mode === "extract" ? "✨ Extract" : "🗑️ Remove"}
                                </span>
                                <span
                                    style={{
                                        fontSize: "0.65rem",
                                        padding: "2px 10px",
                                        borderRadius: "10px",
                                        fontWeight: 600,
                                        textTransform: "uppercase",
                                        background: "rgba(30, 58, 95, 0.15)",
                                        color: "var(--ghost-primary)",
                                    }}
                                >
                                    sam-audio-{modelSize}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Metrics Grid */}
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                        gap: "12px",
                        marginBottom: "20px",
                    }}
                >
                    {/* RTF */}
                    <div
                        style={{
                            padding: "14px",
                            borderRadius: "10px",
                            background: "var(--bg-tertiary)",
                            border: "1px solid var(--glass-border)",
                            textAlign: "center",
                        }}
                    >
                        <div
                            style={{
                                fontSize: "0.6rem",
                                color: "var(--text-muted)",
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                marginBottom: "4px",
                            }}
                        >
                            <Clock style={{ width: "10px", height: "10px", display: "inline", marginRight: "4px", verticalAlign: "middle" }} />
                            RTF
                        </div>
                        <div
                            style={{
                                fontSize: "1.2rem",
                                fontWeight: 700,
                                fontFamily: "monospace",
                                color: metrics.isRealtime ? "var(--ghost-success)" : "var(--ghost-warning)",
                            }}
                        >
                            {metrics.rtf.toFixed(3)}
                        </div>
                        <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
                            {metrics.isRealtime ? "✅ Real-time capable" : "⚠️ Above real-time"}
                        </div>
                    </div>

                    {/* Speed */}
                    <div
                        style={{
                            padding: "14px",
                            borderRadius: "10px",
                            background: "var(--bg-tertiary)",
                            border: "1px solid var(--glass-border)",
                            textAlign: "center",
                        }}
                    >
                        <div
                            style={{
                                fontSize: "0.6rem",
                                color: "var(--text-muted)",
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                marginBottom: "4px",
                            }}
                        >
                            <Zap style={{ width: "10px", height: "10px", display: "inline", marginRight: "4px", verticalAlign: "middle" }} />
                            Speed
                        </div>
                        <div
                            style={{
                                fontSize: "1.2rem",
                                fontWeight: 700,
                                fontFamily: "monospace",
                                color: "#F59E0B",
                            }}
                        >
                            {metrics.speedup.toFixed(1)}x
                        </div>
                        <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
                            vs real-time
                        </div>
                    </div>

                    {/* Audio Duration */}
                    <div
                        style={{
                            padding: "14px",
                            borderRadius: "10px",
                            background: "var(--bg-tertiary)",
                            border: "1px solid var(--glass-border)",
                            textAlign: "center",
                        }}
                    >
                        <div
                            style={{
                                fontSize: "0.6rem",
                                color: "var(--text-muted)",
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                marginBottom: "4px",
                            }}
                        >
                            Audio
                        </div>
                        <div
                            style={{
                                fontSize: "1.2rem",
                                fontWeight: 700,
                                fontFamily: "monospace",
                                color: "var(--text-primary)",
                            }}
                        >
                            {formatTime(audioDuration)}
                        </div>
                        <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
                            duration
                        </div>
                    </div>

                    {/* Processing Time */}
                    <div
                        style={{
                            padding: "14px",
                            borderRadius: "10px",
                            background: "var(--bg-tertiary)",
                            border: "1px solid var(--glass-border)",
                            textAlign: "center",
                        }}
                    >
                        <div
                            style={{
                                fontSize: "0.6rem",
                                color: "var(--text-muted)",
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                                marginBottom: "4px",
                            }}
                        >
                            <Cpu style={{ width: "10px", height: "10px", display: "inline", marginRight: "4px", verticalAlign: "middle" }} />
                            Processed
                        </div>
                        <div
                            style={{
                                fontSize: "1.2rem",
                                fontWeight: 700,
                                fontFamily: "monospace",
                                color: "#10B981",
                            }}
                        >
                            {formatTimePrecise(processingTime)}
                        </div>
                        <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>
                            processing time
                        </div>
                    </div>
                </div>

                {/* Settings Details */}
                <div
                    style={{
                        borderRadius: "10px",
                        border: "1px solid var(--glass-border)",
                        overflow: "hidden",
                    }}
                >
                    <div
                        style={{
                            padding: "10px 14px",
                            background: "var(--bg-tertiary)",
                            borderBottom: "1px solid var(--glass-border)",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            color: "var(--text-muted)",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                        }}
                    >
                        Processing Details
                    </div>
                    <div style={{ padding: "12px 14px" }}>
                        {[
                            { label: "Model", value: `SAM Audio ${modelSize.toUpperCase()}`, icon: Cpu },
                            { label: "Precision", value: metrics.quality, icon: Zap },
                            { label: "Chunk Duration", value: `${chunkDuration}s`, icon: Clock },
                            { label: "Architecture", value: "Flow-Matching Diffusion Transformer", icon: BarChart3 },
                            { label: "Engine", value: "Generative Universal Source Separation", icon: CheckCircle },
                        ].map((row, i) => (
                            <div
                                key={i}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "10px",
                                    padding: "6px 0",
                                    borderBottom: i < 4 ? "1px solid var(--glass-border)" : "none",
                                }}
                            >
                                <row.icon style={{ width: "12px", height: "12px", color: "var(--ghost-primary)", flexShrink: 0 }} />
                                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", flexShrink: 0, minWidth: "100px" }}>
                                    {row.label}
                                </span>
                                <span style={{ fontSize: "0.8rem", color: "var(--text-primary)", fontWeight: 500 }}>
                                    {row.value}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Best Practice Note */}
                <div
                    style={{
                        marginTop: "16px",
                        padding: "12px 14px",
                        borderRadius: "8px",
                        background: "rgba(16, 185, 129, 0.08)",
                        border: "1px solid rgba(16, 185, 129, 0.2)",
                        fontSize: "0.7rem",
                        color: "var(--text-muted)",
                        lineHeight: 1.5,
                    }}
                >
                    <strong style={{ color: "var(--ghost-success)" }}>✓ Preservation Note:</strong>{" "}
                    This restoration used generative AI (Flow-Matching Diffusion Transformer) to {mode === "extract" ? "isolate" : "remove"} &ldquo;{description}&rdquo;. 
                    The original audio file is preserved unchanged. All processing was done at {metrics.quality.toLowerCase()} precision with 
                    {chunkDuration}s chunks. {(rtf) => rtf < 1 ? `RTF of ${metrics.rtf.toFixed(3)} means processing was faster than real-time.` : ""}
                </div>
            </div>
        </div>
    );
}
