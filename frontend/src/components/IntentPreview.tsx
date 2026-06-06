"use client";

import { useMemo } from "react";
import { Search, Mic, Volume2, Music, Sparkles, AlertTriangle } from "lucide-react";

interface IntentPreviewProps {
    description: string;
    mode: "extract" | "remove";
}

interface IntentInsight {
    category: string;
    icon: typeof Mic;
    color: string;
    description: string;
    freqRange: string;
    confidence: number;
}

// Intent classification patterns
const INTENT_PATTERNS: Array<{
    keywords: string[];
    category: string;
    icon: typeof Mic;
    color: string;
    description: (mode: string) => string;
    freqRange: string;
}> = [
    {
        keywords: ["speech", "voice", "vocal", "interview", "dialogue", "spoken", "narration", "talk", "conversation", "oral"],
        category: "Human Speech",
        icon: Mic,
        color: "#8B5CF6",
        description: (mode) => mode === "extract" ? "Extracting human speech frequencies (300Hz–4kHz)" : "Removing non-speech content, preserving voice",
        freqRange: "300Hz – 4kHz",
    },
    {
        keywords: ["music", "instrument", "melody", "song", "guitar", "piano", "drum", "orchestra", "band"],
        category: "Music",
        icon: Music,
        color: "#10B981",
        description: (mode) => mode === "extract" ? "Isolating musical elements" : "Removing musical background",
        freqRange: "80Hz – 8kHz",
    },
    {
        keywords: ["hiss", "tape", "static", "noise floor", "background noise", "white noise"],
        category: "Tape Hiss",
        icon: Volume2,
        color: "#F472B6",
        description: (mode) => mode === "extract" ? "Extracting hiss and static noise" : "Removing tape hiss and steady-state noise",
        freqRange: "4kHz – 20kHz (high freq)",
    },
    {
        keywords: ["crackle", "vinyl", "pop", "click", "scratch", "dust", "record"],
        category: "Crackle/Pops",
        icon: Sparkles,
        color: "#F59E0B",
        description: (mode) => mode === "extract" ? "Isolating impulse noises (clicks/pops)" : "Removing crackle and impulse artifacts",
        freqRange: "Broad spectrum (impulsive)",
    },
    {
        keywords: ["hum", "buzz", "drone", "electrical", "mains", "ground loop", "60hz", "50hz"],
        category: "Electrical Hum",
        icon: AlertTriangle,
        color: "#EF4444",
        description: (mode) => mode === "extract" ? "Extracting electrical hum and buzz" : "Removing mains hum and electrical interference",
        freqRange: "50Hz – 60Hz (fundamental + harmonics)",
    },
    {
        keywords: ["crowd", "noise", "ambient", "room", "reverberation", "echo", "wind", "traffic", "environment"],
        category: "Ambient Noise",
        icon: Volume2,
        color: "#06B6D4",
        description: (mode) => mode === "extract" ? "Isolating ambient/environmental sounds" : "Removing background ambient noise",
        freqRange: "Wide spectrum",
    },
];

function classifyIntent(description: string): IntentInsight[] {
    const lower = description.toLowerCase();
    const results: IntentInsight[] = [];

    for (const pattern of INTENT_PATTERNS) {
        const matchCount = pattern.keywords.filter(kw => lower.includes(kw)).length;
        if (matchCount > 0) {
            // Calculate confidence based on keyword matches
            const confidence = Math.min(0.95, 0.4 + matchCount * 0.15);
            results.push({
                category: pattern.category,
                icon: pattern.icon,
                color: pattern.color,
                description: pattern.description("extract"), // will be updated for mode
                freqRange: pattern.freqRange,
                confidence,
            });
        }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
}

export default function IntentPreview({ description, mode }: IntentPreviewProps) {
    const insights = useMemo(() => classifyIntent(description), [description]);

    if (!description.trim()) {
        return null;
    }

    return (
        <div
            style={{
                marginTop: "14px",
                padding: "14px 16px",
                borderRadius: "12px",
                border: "1px solid var(--glass-border)",
                background: "var(--bg-primary)",
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "12px",
                }}
            >
                <Search style={{ width: "14px", height: "14px", color: "var(--ghost-primary)" }} />
                <span
                    style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                    }}
                >
                    Intent Analysis
                </span>
                <span
                    style={{
                        fontSize: "0.65rem",
                        padding: "2px 8px",
                        borderRadius: "10px",
                        background: mode === "extract"
                            ? "rgba(16, 185, 129, 0.15)"
                            : "rgba(239, 68, 68, 0.15)",
                        color: mode === "extract" ? "var(--ghost-success)" : "var(--ghost-error)",
                        fontWeight: 600,
                        textTransform: "uppercase",
                    }}
                >
                    {mode === "extract" ? "Extract" : "Remove"}
                </span>
            </div>

            {/* Insights */}
            {insights.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {insights.slice(0, 3).map((insight) => {
                        const Icon = insight.icon;
                        return (
                            <div
                                key={insight.category}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "10px",
                                    padding: "8px 10px",
                                    borderRadius: "8px",
                                    background: `${insight.color}0D`,
                                    border: `1px solid ${insight.color}20`,
                                }}
                            >
                                <Icon
                                    style={{
                                        width: "16px",
                                        height: "16px",
                                        color: insight.color,
                                        flexShrink: 0,
                                    }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                        style={{
                                            fontSize: "0.8rem",
                                            fontWeight: 600,
                                            color: "var(--text-primary)",
                                        }}
                                    >
                                        {insight.category}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: "0.7rem",
                                            color: "var(--text-muted)",
                                            marginTop: "1px",
                                        }}
                                    >
                                        {insight.description.replace("extract", mode)} • {insight.freqRange}
                                    </div>
                                </div>
                                <div
                                    style={{
                                        textAlign: "right",
                                        flexShrink: 0,
                                    }}
                                >
                                    <div
                                        style={{
                                            fontSize: "0.75rem",
                                            fontWeight: 700,
                                            color: insight.color,
                                            fontFamily: "monospace",
                                        }}
                                    >
                                        {Math.round(insight.confidence * 100)}%
                                    </div>
                                    <div
                                        style={{
                                            fontSize: "0.6rem",
                                            color: "var(--text-muted)",
                                            textTransform: "uppercase",
                                        }}
                                    >
                                        Match
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* Frequency range visualization bar */}
                    {insights.length > 0 && (
                        <div
                            style={{
                                marginTop: "4px",
                                padding: "10px 12px",
                                borderRadius: "8px",
                                background: "var(--bg-tertiary)",
                            }}
                        >
                            <div
                                style={{
                                    fontSize: "0.65rem",
                                    color: "var(--text-muted)",
                                    marginBottom: "6px",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.3px",
                                }}
                            >
                                Affected Frequency Range
                            </div>
                            <div
                                style={{
                                    position: "relative",
                                    height: "20px",
                                    borderRadius: "4px",
                                    background: "var(--bg-secondary)",
                                    overflow: "hidden",
                                }}
                            >
                                {/* Frequency bar gradient */}
                                <div
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        background: `linear-gradient(to right,
                                            rgba(139, 92, 246, 0.3) 0%,
                                            rgba(16, 185, 129, 0.3) 25%,
                                            rgba(244, 114, 182, 0.3) 50%,
                                            rgba(245, 158, 11, 0.3) 75%,
                                            rgba(239, 68, 68, 0.3) 100%)`,
                                    }}
                                />
                                {/* Active ranges for each detected intent */}
                                {insights.slice(0, 3).map((insight, i) => {
                                    const range = insight.freqRange;
                                    const left = range.includes("50") ? 2 : range.includes("80") ? 5 : range.includes("300") ? 10 : range.includes("4k") ? 40 : 0;
                                    const width = range.includes("impulsive") ? 98 : range.includes("Broad") ? 90 : range.includes("20k") ? 60 : range.includes("8k") ? 70 : range.includes("4k") ? 50 : range.includes("60") ? 15 : range.includes("50") ? 10 : 40;
                                    return (
                                        <div
                                            key={i}
                                            style={{
                                                position: "absolute",
                                                top: 0,
                                                bottom: 0,
                                                left: `${left}%`,
                                                width: `${width}%`,
                                                background: `${insight.color}40`,
                                                borderLeft: `2px solid ${insight.color}`,
                                                borderRight: `2px solid ${insight.color}`,
                                                opacity: 0.6,
                                            }}
                                            title={`${insight.category}: ${insight.freqRange}`}
                                        />
                                    );
                                })}
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    marginTop: "4px",
                                    fontSize: "0.6rem",
                                    color: "var(--text-muted)",
                                }}
                            >
                                <span>50Hz</span>
                                <span>500Hz</span>
                                <span>2kHz</span>
                                <span>8kHz</span>
                                <span>20kHz</span>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    No specific patterns detected. The AI will process based on your full description.
                </div>
            )}
        </div>
    );
}
