"use client";

import { Ghost, Loader2, CheckCircle2, Upload } from "lucide-react";

interface ProgressTrackerProps {
    status: "uploading" | "pending" | "processing";
    progress: number;
    message: string;
}

export default function ProgressTracker({ status, progress, message }: ProgressTrackerProps) {
    const steps = [
        { step: "Loading model", threshold: 10 },
        { step: "Processing audio", threshold: 30 },
        { step: "Running separation", threshold: 50 },
        { step: "Saving results", threshold: 80 },
    ];

    const isUploading = status === "uploading";

    return (
        <div
            style={{
                background: "var(--bg-secondary)",
                borderRadius: "20px",
                border: "1px solid var(--glass-border)",
                padding: "48px 40px"
            }}
        >
            {/* Icon */}
            <div style={{ textAlign: "center", marginBottom: "32px" }}>
                <div
                    style={{
                        width: "80px",
                        height: "80px",
                        borderRadius: "20px",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: isUploading
                            ? "linear-gradient(135deg, var(--ghost-secondary), var(--ghost-accent))"
                            : "linear-gradient(135deg, var(--ghost-primary), var(--ghost-accent))",
                        boxShadow: isUploading
                            ? "0 8px 32px rgba(6, 182, 212, 0.3)"
                            : "0 8px 32px rgba(168, 85, 247, 0.3)"
                    }}
                >
                    {isUploading ? (
                        <Upload
                            style={{
                                width: "40px",
                                height: "40px",
                                color: "white",
                                animation: "bounce 1s ease-in-out infinite"
                            }}
                        />
                    ) : status === "pending" ? (
                        <Ghost style={{ width: "40px", height: "40px", color: "white" }} />
                    ) : (
                        <Loader2
                            style={{
                                width: "40px",
                                height: "40px",
                                color: "white",
                                animation: "spin 1s linear infinite"
                            }}
                        />
                    )}
                </div>
            </div>

            {/* Title */}
            <h3
                style={{
                    fontSize: "1.5rem",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    textAlign: "center",
                    marginBottom: "8px"
                }}
            >
                {isUploading ? "Uploading File..." : status === "pending" ? "Waiting in Queue..." : "Processing Audio..."}
            </h3>

            {/* Message */}
            <p
                style={{
                    fontSize: "0.9rem",
                    color: "var(--text-muted)",
                    textAlign: "center",
                    marginBottom: "32px"
                }}
            >
                {message}
            </p>

            {/* Progress Bar */}
            <div style={{ marginBottom: isUploading ? "0" : "32px" }}>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: "10px"
                    }}
                >
                    <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                        {isUploading ? "Upload" : "Progress"}
                    </span>
                    <span
                        style={{
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            color: isUploading ? "var(--ghost-secondary)" : "var(--ghost-primary)"
                        }}
                    >
                        {progress}%
                    </span>
                </div>
                <div
                    style={{
                        height: "8px",
                        borderRadius: "4px",
                        background: "var(--bg-tertiary)",
                        overflow: "hidden"
                    }}
                >
                    <div
                        style={{
                            height: "100%",
                            borderRadius: "4px",
                            background: isUploading
                                ? "linear-gradient(90deg, var(--ghost-secondary), var(--ghost-accent))"
                                : "linear-gradient(90deg, var(--ghost-primary), var(--ghost-accent))",
                            width: `${progress}%`,
                            transition: "width 0.2s ease"
                        }}
                    />
                </div>
            </div>

            {/* Steps — only shown during processing phase */}
            {!isUploading && (
            <div
                style={{
                    background: "var(--bg-tertiary)",
                    borderRadius: "12px",
                    padding: "20px",
                    marginTop: "32px"
                }}
            >
                {steps.map(({ step, threshold }, index) => {
                    const isComplete = progress >= threshold;
                    const isActive = !isComplete && progress >= threshold - 20;

                    return (
                        <div
                            key={step}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "14px",
                                padding: "12px 0",
                                borderBottom: index < steps.length - 1
                                    ? "1px solid var(--border-color)"
                                    : "none"
                            }}
                        >
                            {/* Status Icon */}
                            <div
                                style={{
                                    width: "24px",
                                    height: "24px",
                                    borderRadius: "50%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                    background: isComplete
                                        ? "linear-gradient(135deg, #10B981, #34D399)"
                                        : isActive
                                            ? "var(--ghost-primary)"
                                            : "transparent",
                                    border: isComplete || isActive
                                        ? "none"
                                        : "2px solid var(--text-muted)"
                                }}
                            >
                                {isComplete ? (
                                    <CheckCircle2
                                        style={{
                                            width: "14px",
                                            height: "14px",
                                            color: "white"
                                        }}
                                    />
                                ) : isActive ? (
                                    <Loader2
                                        style={{
                                            width: "12px",
                                            height: "12px",
                                            color: "white",
                                            animation: "spin 1s linear infinite"
                                        }}
                                    />
                                ) : null}
                            </div>

                            {/* Step Label */}
                            <span
                                style={{
                                    fontSize: "0.9rem",
                                    fontWeight: isComplete || isActive ? 500 : 400,
                                    color: isComplete
                                        ? "var(--text-primary)"
                                        : isActive
                                            ? "var(--ghost-primary)"
                                            : "var(--text-muted)"
                                }}
                            >
                                {step}
                            </span>
                        </div>
                    );
                })}
            </div>
            )}
        </div>
    );
}
