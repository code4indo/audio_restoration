"use client";

import { useState } from "react";
import {
    Mic,
    Music,
    Volume2,
    Sparkles,
    Clock,
    Cpu,
    Search,
    Sliders,
    Zap,
    BookOpen,
    Radio,
    Headphones,
    RadioReceiver,
    Disc3,
    Wifi,
    Tv,
    ScrollText,
} from "lucide-react";
import IntentPreview from "./IntentPreview";

interface SeparationSettings {
    modelSize: "small" | "base" | "large";
    chunkDuration: number;
    useFloat32: boolean;
}

interface SeparationPanelProps {
    onSeparate: (description: string, mode: "extract" | "remove", modelSize: string, chunkDuration: number, useFloat32: boolean) => void;
    hasRegion: boolean;
    // Persistent settings from parent
    settings: SeparationSettings;
    onSettingsChange: (settings: SeparationSettings) => void;
}

const QUICK_PROMPTS = [
    { icon: Mic, label: "Speech", prompt: "human speech, spoken voice, talking", color: "#8B5CF6" },
    { icon: Mic, label: "Interview", prompt: "oral history interview voice, person speaking", color: "#06B6D4" },
    { icon: Volume2, label: "Tape Hiss", prompt: "tape hiss", color: "#F472B6" },
    { icon: Sparkles, label: "Crackle", prompt: "vinyl crackle and static noise", color: "#10B981" },
    { icon: Volume2, label: "Hum", prompt: "electrical hum, buzzing sound", color: "#F59E0B" },
    { icon: Music, label: "Crowd", prompt: "crowd noise, audience chatter", color: "#EF4444" },
];

// Restoration Presets — curated intents for archival workflows
//
// IMPORTANT: SAM Audio separates audio into TARGET (matches prompt) and RESIDUAL (everything else).
// - mode="extract" → user wants the TARGET as the isolated output. Prompt should describe what to KEEP.
// - mode="remove"  → user wants the RESIDUAL as the clean output. Prompt should describe what to DISCARD.
// NEVER mix "keep X, remove Y" in one prompt — the model will be confused and quality drops.
//
const PRESETS = [
    {
        id: "speech-enhance",
        category: "🎤 Speech",
        label: "Enhance Speech",
        description: "Extract and enhance human speech, removing all background noise",
        prompt: "human speech, spoken voice, talking, dialogue",
        mode: "extract" as const,
        modelSize: "base",
        icon: Headphones,
        color: "#8B5CF6",
        badge: "Popular",
    },
    {
        id: "tape-hiss",
        category: "📼 Tape",
        label: "Remove Tape Hiss",
        description: "Clean analog tape hiss and steady-state background noise",
        prompt: "tape hiss, analog tape noise, steady hissing sound",
        mode: "remove" as const,
        modelSize: "small",
        icon: Radio,
        color: "#F472B6",
        badge: "Archival",
    },
    {
        id: "vinyl-crackle",
        category: "💿 Vinyl",
        label: "Clean Crackle/Pops",
        description: "Remove vinyl crackle, pops, clicks, and impulse noise",
        prompt: "vinyl crackle, pops, clicks, and static noise",
        mode: "remove" as const,
        modelSize: "small",
        icon: Disc3,
        color: "#10B981",
        badge: "Archival",
    },
    {
        id: "hum-removal",
        category: "⚡ Electrical",
        label: "Remove Hum",
        description: "Eliminate electrical mains hum, buzz, and ground loop noise",
        prompt: "electrical hum, 50Hz 60Hz buzzing, ground loop noise",
        mode: "remove" as const,
        modelSize: "base",
        icon: Zap,
        color: "#F59E0B",
        badge: "Common",
    },
    {
        id: "dialogue-isolate",
        category: "🎙️ Dialogue",
        label: "Isolate Dialogue",
        description: "Extract dialogue from film/TV audio, remove music and effects",
        prompt: "dialogue, speech, people talking",
        mode: "extract" as const,
        modelSize: "large",
        icon: Tv,
        color: "#06B6D4",
        badge: "Advanced",
    },
    {
        id: "ambient-clean",
        category: "🌿 Ambient",
        label: "Clean Background",
        description: "Remove crowd noise, wind, room echo, and environmental sounds",
        prompt: "crowd noise, wind, ambient room sounds, environmental noise",
        mode: "remove" as const,
        modelSize: "base",
        icon: Wifi,
        color: "#EF4444",
        badge: "Common",
    },
    {
        id: "oral-history",
        category: "📜 Archive",
        label: "Restore Oral History",
        description: "Full restoration of archival oral history recordings — extracts clean speech",
        prompt: "human speech, spoken voice, talking, dialogue, narration",
        mode: "extract" as const,
        modelSize: "large",
        icon: ScrollText,
        color: "#A855F7",
        badge: "Archival",
    },
    {
        id: "noise-cleanup",
        category: "🔇 Noise",
        label: "Remove All Noise",
        description: "Remove tape hiss, crackle, hum, and background noise from archival recordings",
        prompt: "tape hiss, crackle, pops, electrical hum, static noise, background noise",
        mode: "remove" as const,
        modelSize: "large",
        icon: RadioReceiver,
        color: "#F97316",
        badge: "Archival",
    },
    {
        id: "music-extract",
        category: "🎵 Music",
        label: "Extract Music",
        description: "Isolate musical instruments and melody from mixed audio",
        prompt: "music, musical instruments, melody, singing",
        mode: "extract" as const,
        modelSize: "large",
        icon: Music,
        color: "#EC4899",
        badge: "Advanced",
    },
];

const MODEL_OPTIONS = [
    { value: "small", label: "Small", vram: "~6GB", vramFp32: "~9GB", speed: "Fast" },
    { value: "base", label: "Base", vram: "~7GB", vramFp32: "~10GB", speed: "Balanced" },
    { value: "large", label: "Large", vram: "~10GB", vramFp32: "~13GB", speed: "Best" },
] as const;

export default function SeparationPanel({
    onSeparate,
    hasRegion,
    settings,
    onSettingsChange
}: SeparationPanelProps) {
    // Only prompt and mode are local (reset each time)
    const [customPrompt, setCustomPrompt] = useState("");
    const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
    const [mode, setMode] = useState<"extract" | "remove">("extract");
    const [showPresets, setShowPresets] = useState(false);
    const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

    // Destructure settings for easier access
    const { modelSize, chunkDuration, useFloat32 } = settings;

    // Helper to update a single setting
    const updateSetting = <K extends keyof SeparationSettings>(key: K, value: SeparationSettings[K]) => {
        onSettingsChange({ ...settings, [key]: value });
    };

    const handleQuickSelect = (prompt: string) => {
        setSelectedPrompt(prompt);
        setCustomPrompt(prompt);
        setSelectedPreset(null);
    };

    const handlePresetSelect = (preset: typeof PRESETS[0]) => {
        setSelectedPreset(preset.id);
        setCustomPrompt(preset.prompt);
        setSelectedPrompt(null);
        setMode(preset.mode);
        updateSetting("modelSize", preset.modelSize as "small" | "base" | "large");
        setShowPresets(false);
    };

    const handleSeparate = () => {
        const prompt = customPrompt || selectedPrompt;
        if (!prompt) return;

        onSeparate(prompt, mode, modelSize, chunkDuration, useFloat32);
    };

    const activePrompt = customPrompt || selectedPrompt;

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
                <h3 style={{
                    fontSize: "1rem",
                    fontWeight: 600,
                    color: "var(--text-primary)"
                }}>
                    Separation Settings
                </h3>

                {hasRegion && (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "6px 12px",
                            borderRadius: "20px",
                            fontSize: "0.75rem",
                            background: "rgba(244, 114, 182, 0.15)",
                            color: "var(--ghost-accent)"
                        }}
                    >
                        <Clock style={{ width: "12px", height: "12px" }} />
                        Temporal Lock
                    </div>
                )}
            </div>

            <div style={{ padding: "24px" }}>

                {/* ============================================ */}
                {/* PRESETS — Quick restoration templates         */}
                {/* ============================================ */}
                <div
                    style={{
                        marginBottom: "20px",
                        borderRadius: "12px",
                        border: `1px solid ${showPresets ? "var(--ghost-primary)" : "var(--glass-border)"}`,
                        overflow: "hidden",
                        transition: "border-color 0.2s",
                    }}
                >
                    <button
                        onClick={() => setShowPresets(!showPresets)}
                        style={{
                            width: "100%",
                            padding: "12px 16px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            background: showPresets ? "rgba(168, 85, 247, 0.08)" : "var(--bg-tertiary)",
                            border: "none",
                            cursor: "pointer",
                            color: "var(--text-primary)",
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            transition: "all 0.2s",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <BookOpen style={{ width: "16px", height: "16px", color: "var(--ghost-primary)" }} />
                            <span>Restoration Presets</span>
                            {selectedPreset && (
                                <span
                                    style={{
                                        fontSize: "0.65rem",
                                        padding: "2px 8px",
                                        borderRadius: "8px",
                                        background: "rgba(168, 85, 247, 0.15)",
                                        color: "var(--ghost-primary)",
                                        fontWeight: 500,
                                    }}
                                >
                                    {PRESETS.find(p => p.id === selectedPreset)?.label}
                                </span>
                            )}
                        </div>
                        <span
                            style={{
                                fontSize: "0.75rem",
                                color: "var(--text-muted)",
                                transform: showPresets ? "rotate(180deg)" : "none",
                                transition: "transform 0.2s",
                            }}
                        >
                            ▼
                        </span>
                    </button>

                    {showPresets && (
                        <div style={{ padding: "16px" }}>
                            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "12px", lineHeight: 1.4 }}>
                                Choose a restoration preset tailored for archival workflows. Each preset configures the optimal prompt, mode, and model size automatically.
                            </p>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "8px" }}>
                                {PRESETS.map((preset) => {
                                    const Icon = preset.icon;
                                    const isActive = selectedPreset === preset.id;
                                    return (
                                        <button
                                            key={preset.id}
                                            onClick={() => handlePresetSelect(preset)}
                                            style={{
                                                display: "flex",
                                                alignItems: "flex-start",
                                                gap: "10px",
                                                padding: "12px",
                                                borderRadius: "10px",
                                                border: `1px solid ${isActive ? preset.color : "var(--glass-border)"}`,
                                                background: isActive ? `${preset.color}10` : "var(--bg-primary)",
                                                cursor: "pointer",
                                                textAlign: "left",
                                                transition: "all 0.2s",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    width: "32px",
                                                    height: "32px",
                                                    borderRadius: "8px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    background: `${preset.color}20`,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                <Icon style={{ width: "14px", height: "14px", color: preset.color }} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                                    <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>
                                                        {preset.label}
                                                    </span>
                                                    <span
                                                        style={{
                                                            fontSize: "0.55rem",
                                                            padding: "1px 6px",
                                                            borderRadius: "6px",
                                                            fontWeight: 600,
                                                            textTransform: "uppercase",
                                                            background: isActive ? `${preset.color}30` : "var(--bg-tertiary)",
                                                            color: isActive ? preset.color : "var(--text-muted)",
                                                        }}
                                                    >
                                                        {preset.badge}
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "2px", lineHeight: 1.3 }}>
                                                    {preset.description}
                                                </div>
                                                <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                                                    <span
                                                        style={{
                                                            fontSize: "0.55rem",
                                                            padding: "1px 5px",
                                                            borderRadius: "4px",
                                                            background: isActive ? `${preset.color}20` : "var(--bg-tertiary)",
                                                            color: isActive ? preset.color : "var(--text-muted)",
                                                            fontWeight: 600,
                                                            textTransform: "uppercase",
                                                        }}
                                                    >
                                                        {preset.mode === "extract" ? "Extract" : "Remove"}
                                                    </span>
                                                    <span
                                                        style={{
                                                            fontSize: "0.55rem",
                                                            padding: "1px 5px",
                                                            borderRadius: "4px",
                                                            background: "var(--bg-tertiary)",
                                                            color: "var(--text-muted)",
                                                        }}
                                                    >
                                                        {preset.modelSize}
                                                    </span>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* ============================================ */}
                {/* MAIN INPUT - Describe the sound (PROMINENT) */}
                {/* ============================================ */}
                <div
                    style={{
                        marginBottom: "24px",
                        padding: "20px",
                        borderRadius: "14px",
                        background: "linear-gradient(135deg, rgba(168, 85, 247, 0.1), rgba(244, 114, 182, 0.1))",
                        border: "1px solid rgba(168, 85, 247, 0.2)"
                    }}
                >
                    <label style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontSize: "0.9rem",
                        fontWeight: 600,
                        marginBottom: "12px",
                        color: "var(--text-primary)"
                    }}>
                        <Search style={{ width: "16px", height: "16px", color: "var(--ghost-primary)" }} />
                        Describe the archival sound you want to {mode}
                    </label>
                    <input
                        type="text"
                        value={customPrompt}
                        onChange={(e) => {
                            setCustomPrompt(e.target.value);
                            setSelectedPrompt(null);
                        }}
                        placeholder="e.g., human speech only, interview voice, tape hiss, vinyl crackle, electrical hum..."
                        style={{
                            width: "100%",
                            padding: "16px 18px",
                            borderRadius: "12px",
                            border: "2px solid var(--ghost-primary)",
                            background: "var(--bg-primary)",
                            color: "var(--text-primary)",
                            fontSize: "1rem",
                            fontWeight: 500,
                            outline: "none",
                            boxShadow: "0 4px 15px rgba(168, 85, 247, 0.15)"
                        }}
                    />

                    {/* Quick Select Tags */}
                    <div style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "8px",
                        marginTop: "14px"
                    }}>
                        {QUICK_PROMPTS.map(({ icon: Icon, label, prompt, color }) => (
                            <button
                                key={prompt}
                                onClick={() => handleQuickSelect(prompt)}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "8px 12px",
                                    borderRadius: "20px",
                                    border: "none",
                                    cursor: "pointer",
                                    fontSize: "0.8rem",
                                    fontWeight: 500,
                                    transition: "all 0.2s",
                                    background: selectedPrompt === prompt
                                        ? `linear-gradient(135deg, ${color}, ${color}dd)`
                                        : "var(--bg-tertiary)",
                                    color: selectedPrompt === prompt
                                        ? "white"
                                        : "var(--text-secondary)"
                                }}
                            >
                                <Icon style={{ width: "14px", height: "14px" }} />
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Intent Preview — shows what the AI understands */}
                    <IntentPreview description={customPrompt || selectedPrompt || ""} mode={mode} />
                </div>

                {/* Settings Grid */}
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "20px",
                    marginBottom: "20px"
                }}>

                    {/* Mode Toggle */}
                    <div>
                        <label style={{
                            display: "block",
                            fontSize: "0.8rem",
                            fontWeight: 500,
                            marginBottom: "10px",
                            color: "var(--text-muted)"
                        }}>
                            Operation
                        </label>
                        <div style={{ display: "flex", gap: "8px" }}>
                            <button
                                onClick={() => setMode("extract")}
                                style={{
                                    flex: 1,
                                    padding: "12px",
                                    borderRadius: "10px",
                                    fontWeight: 500,
                                    fontSize: "0.85rem",
                                    border: "none",
                                    cursor: "pointer",
                                    background: mode === "extract"
                                        ? "linear-gradient(135deg, var(--ghost-primary), #7C3AED)"
                                        : "var(--bg-tertiary)",
                                    color: mode === "extract" ? "white" : "var(--text-secondary)"
                                }}
                            >
                                ✨ Extract
                            </button>
                            <button
                                onClick={() => setMode("remove")}
                                style={{
                                    flex: 1,
                                    padding: "12px",
                                    borderRadius: "10px",
                                    fontWeight: 500,
                                    fontSize: "0.85rem",
                                    border: "none",
                                    cursor: "pointer",
                                    background: mode === "remove"
                                        ? "linear-gradient(135deg, var(--ghost-error), #DC2626)"
                                        : "var(--bg-tertiary)",
                                    color: mode === "remove" ? "white" : "var(--text-secondary)"
                                }}
                            >
                                🗑️ Remove
                            </button>
                        </div>
                    </div>

                    {/* Model Selector */}
                    <div>
                        <label style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "0.8rem",
                            fontWeight: 500,
                            marginBottom: "10px",
                            color: "var(--text-muted)"
                        }}>
                            <Cpu style={{ width: "12px", height: "12px" }} />
                            Model
                        </label>
                        <div style={{ display: "flex", gap: "6px" }}>
                            {MODEL_OPTIONS.map(({ value, label, vram, vramFp32 }) => (
                                <button
                                    key={value}
                                    onClick={() => updateSetting("modelSize", value)}
                                    style={{
                                        flex: 1,
                                        padding: "10px 8px",
                                        borderRadius: "8px",
                                        border: "none",
                                        cursor: "pointer",
                                        textAlign: "center",
                                        background: modelSize === value
                                            ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                                            : "var(--bg-tertiary)",
                                        color: modelSize === value ? "white" : "var(--text-secondary)"
                                    }}
                                >
                                    <div style={{ fontWeight: 500, fontSize: "0.8rem" }}>{label}</div>
                                    <div style={{ fontSize: "0.65rem", opacity: 0.7, marginTop: "2px" }}>
                                        {useFloat32 ? vramFp32 : vram}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Float32 Precision Toggle */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "14px 16px",
                        marginBottom: "20px",
                        borderRadius: "10px",
                        background: useFloat32
                            ? "linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(6, 182, 212, 0.1))"
                            : "var(--bg-tertiary)",
                        border: useFloat32
                            ? "1px solid rgba(16, 185, 129, 0.3)"
                            : "1px solid var(--border-color)"
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <Zap style={{
                            width: "16px",
                            height: "16px",
                            color: useFloat32 ? "#10B981" : "var(--text-muted)"
                        }} />
                        <div>
                            <div style={{
                                fontSize: "0.85rem",
                                fontWeight: 500,
                                color: "var(--text-primary)"
                            }}>
                                High Quality Mode (float32)
                            </div>
                            <div style={{
                                fontSize: "0.7rem",
                                color: "var(--text-muted)",
                                marginTop: "2px"
                            }}>
                                Better separation quality, +2-3GB VRAM
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => updateSetting("useFloat32", !useFloat32)}
                        style={{
                            width: "44px",
                            height: "24px",
                            borderRadius: "12px",
                            border: "none",
                            cursor: "pointer",
                            position: "relative",
                            background: useFloat32
                                ? "linear-gradient(135deg, #10B981, #06B6D4)"
                                : "var(--bg-secondary)",
                            transition: "all 0.2s ease"
                        }}
                    >
                        <div style={{
                            width: "18px",
                            height: "18px",
                            borderRadius: "50%",
                            background: "white",
                            position: "absolute",
                            top: "3px",
                            left: useFloat32 ? "23px" : "3px",
                            transition: "left 0.2s ease",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.2)"
                        }} />
                    </button>
                </div>

                {/* Chunk Duration Slider */}
                <div
                    style={{
                        marginBottom: "20px",
                        padding: "16px",
                        borderRadius: "12px",
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--border-color)"
                    }}
                >
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "12px"
                    }}>
                        <label style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            fontSize: "0.8rem",
                            fontWeight: 500,
                            color: "var(--text-muted)"
                        }}>
                            <Sliders style={{ width: "14px", height: "14px" }} />
                            Chunk Duration
                        </label>
                        <span style={{
                            fontSize: "0.9rem",
                            fontWeight: 600,
                            color: "var(--ghost-primary)",
                            fontFamily: "monospace"
                        }}>
                            {chunkDuration}s
                        </span>
                    </div>

                    <input
                        type="range"
                        min="5"
                        max="60"
                        step="5"
                        value={chunkDuration}
                        onChange={(e) => updateSetting("chunkDuration", Number(e.target.value))}
                        style={{
                            width: "100%",
                            height: "6px",
                            borderRadius: "3px",
                            background: `linear-gradient(to right, var(--ghost-primary) ${((chunkDuration - 5) / 55) * 100}%, var(--bg-secondary) ${((chunkDuration - 5) / 55) * 100}%)`,
                            cursor: "pointer",
                            appearance: "none",
                            outline: "none"
                        }}
                    />

                    <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: "8px",
                        fontSize: "0.65rem",
                        color: "var(--text-muted)"
                    }}>
                        <span>5s (Low VRAM)</span>
                        <span>60s (Fast)</span>
                    </div>

                    <p style={{
                        marginTop: "10px",
                        fontSize: "0.7rem",
                        color: "var(--text-muted)",
                        lineHeight: 1.4
                    }}>
                        ⚡ Smaller chunks = Less VRAM usage, but slower processing & may affect quality at boundaries
                    </p>
                </div>

                {/* Action Button */}
                <button
                    onClick={handleSeparate}
                    disabled={!activePrompt}
                    style={{
                        width: "100%",
                        padding: "16px",
                        borderRadius: "12px",
                        border: "none",
                        cursor: activePrompt ? "pointer" : "not-allowed",
                        fontSize: "1rem",
                        fontWeight: 600,
                        background: activePrompt
                            ? "linear-gradient(135deg, var(--ghost-primary), var(--ghost-accent))"
                            : "var(--bg-tertiary)",
                        color: activePrompt ? "white" : "var(--text-muted)",
                        opacity: activePrompt ? 1 : 0.6,
                        boxShadow: activePrompt ? "0 4px 15px rgba(168, 85, 247, 0.3)" : "none"
                    }}
                >
                    {mode === "extract" ? "✨ Extract" : "🗑️ Remove"} "{activePrompt || "..."}"
                </button>
            </div>
        </div>
    );
}
