"use client";

import { useState, useEffect } from "react";
import { Layers, Play, Trash2, Clock, CheckCircle, XCircle, Loader, AlertTriangle, FileAudio } from "lucide-react";

export interface BatchItem {
    id: string;
    filename: string;
    description: string;
    mode: "extract" | "remove";
    status: "pending" | "processing" | "completed" | "failed";
    progress: number;
    error?: string;
    taskId?: string;
}

interface BatchQueueProps {
    onStartBatch: (items: BatchItem[]) => void;
    processing: boolean;
}

// Generate a unique ID
let idCounter = 0;
function genId(): string {
    return `batch-${Date.now()}-${++idCounter}`;
}

export default function BatchQueue({ onStartBatch, processing }: BatchQueueProps) {
    const [items, setItems] = useState<BatchItem[]>([]);
    const [newFilename, setNewFilename] = useState("");
    const [newDescription, setNewDescription] = useState("");
    const [newMode, setNewMode] = useState<"extract" | "remove">("extract");

    // Load from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem("batchQueue");
            if (saved) setItems(JSON.parse(saved));
        } catch {}
    }, []);

    // Save to localStorage
    useEffect(() => {
        localStorage.setItem("batchQueue", JSON.stringify(items));
    }, [items]);

    const addItem = () => {
        if (!newFilename.trim() || !newDescription.trim()) return;
        const item: BatchItem = {
            id: genId(),
            filename: newFilename.trim(),
            description: newDescription.trim(),
            mode: newMode,
            status: "pending",
            progress: 0,
        };
        setItems(prev => [...prev, item]);
        setNewFilename("");
        setNewDescription("");
    };

    const removeItem = (id: string) => {
        setItems(prev => prev.filter(i => i.id !== id));
    };

    const clearAll = () => {
        setItems([]);
    };

    const startBatch = () => {
        const pending = items.filter(i => i.status === "pending");
        if (pending.length === 0) return;
        onStartBatch(pending);
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case "completed": return <CheckCircle style={{ width: "14px", height: "14px", color: "var(--ghost-success)" }} />;
            case "failed": return <XCircle style={{ width: "14px", height: "14px", color: "var(--ghost-error)" }} />;
            case "processing": return <div style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid var(--ghost-primary)", borderTopColor: "transparent", animation: "spin 1s linear infinite" }} />;
            default: return <Clock style={{ width: "14px", height: "14px", color: "var(--text-muted)" }} />;
        }
    };

    const pendingCount = items.filter(i => i.status === "pending").length;
    const completedCount = items.filter(i => i.status === "completed").length;

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
                    <Layers style={{ width: "16px", height: "16px", color: "var(--ghost-primary)" }} />
                    <h3 style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
                        Batch Queue
                    </h3>
                    {items.length > 0 && (
                        <span
                            style={{
                                fontSize: "0.65rem",
                                padding: "2px 8px",
                                borderRadius: "10px",
                                background: "var(--bg-tertiary)",
                                color: "var(--text-muted)",
                            }}
                        >
                            {completedCount}/{items.length}
                        </span>
                    )}
                </div>
                {items.length > 0 && (
                    <button
                        onClick={clearAll}
                        style={{
                            padding: "4px 10px",
                            borderRadius: "6px",
                            background: "var(--bg-tertiary)",
                            color: "var(--text-muted)",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "0.7rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                        }}
                    >
                        <Trash2 style={{ width: "10px", height: "10px" }} />
                        Clear All
                    </button>
                )}
            </div>

            <div style={{ padding: "16px 20px" }}>
                {/* Add Item Form */}
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 2fr auto auto",
                        gap: "8px",
                        marginBottom: "16px",
                    }}
                >
                    <input
                        type="text"
                        value={newFilename}
                        onChange={(e) => setNewFilename(e.target.value)}
                        placeholder="Filename (e.g., tape_01.wav)"
                        style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--glass-border)",
                            background: "var(--bg-primary)",
                            color: "var(--text-primary)",
                            fontSize: "0.8rem",
                            outline: "none",
                        }}
                        onKeyDown={(e) => e.key === "Enter" && addItem()}
                    />
                    <input
                        type="text"
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        placeholder="Intent (e.g., remove tape hiss)"
                        style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--glass-border)",
                            background: "var(--bg-primary)",
                            color: "var(--text-primary)",
                            fontSize: "0.8rem",
                            outline: "none",
                        }}
                        onKeyDown={(e) => e.key === "Enter" && addItem()}
                    />
                    <select
                        value={newMode}
                        onChange={(e) => setNewMode(e.target.value as "extract" | "remove")}
                        style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--glass-border)",
                            background: "var(--bg-primary)",
                            color: "var(--text-primary)",
                            fontSize: "0.8rem",
                            outline: "none",
                            cursor: "pointer",
                        }}
                    >
                        <option value="extract">Extract</option>
                        <option value="remove">Remove</option>
                    </select>
                    <button
                        onClick={addItem}
                        disabled={!newFilename.trim() || !newDescription.trim()}
                        style={{
                            padding: "10px 16px",
                            borderRadius: "8px",
                            border: "none",
                            cursor: "pointer",
                            fontWeight: 600,
                            fontSize: "0.8rem",
                            background: !newFilename.trim() || !newDescription.trim()
                                ? "var(--bg-tertiary)"
                                : "linear-gradient(135deg, var(--ghost-primary), var(--ghost-accent))",
                            color: !newFilename.trim() || !newDescription.trim() ? "var(--text-muted)" : "white",
                        }}
                    >
                        + Add
                    </button>
                </div>

                {/* Quick templates for archivists */}
                <div
                    style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "6px",
                        marginBottom: "16px",
                    }}
                >
                    {[
                        { label: "Remove tape hiss", desc: "remove tape hiss", mode: "remove" as const },
                        { label: "Extract speech", desc: "human speech only", mode: "extract" as const },
                        { label: "Remove crackle", desc: "vinyl crackle and pops", mode: "remove" as const },
                        { label: "Remove hum", desc: "electrical hum 60Hz", mode: "remove" as const },
                        { label: "Extract music", desc: "background music", mode: "extract" as const },
                    ].map((tpl) => (
                        <button
                            key={tpl.label}
                            onClick={() => {
                                setNewDescription(tpl.desc);
                                setNewMode(tpl.mode);
                            }}
                            style={{
                                padding: "4px 10px",
                                borderRadius: "12px",
                                border: "1px solid var(--glass-border)",
                                background: "var(--bg-tertiary)",
                                color: "var(--text-secondary)",
                                cursor: "pointer",
                                fontSize: "0.7rem",
                                fontWeight: 500,
                                transition: "all 0.2s",
                            }}
                        >
                            {tpl.label}
                        </button>
                    ))}
                </div>

                {/* Item List */}
                {items.length === 0 ? (
                    <div
                        style={{
                            textAlign: "center",
                            padding: "24px",
                            color: "var(--text-muted)",
                            fontSize: "0.8rem",
                        }}
                    >
                        <FileAudio style={{ width: "32px", height: "32px", margin: "0 auto 8px", opacity: 0.3 }} />
                        <p>Queue is empty. Add files and intents to process in batch.</p>
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {items.map((item) => (
                            <div
                                key={item.id}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "10px",
                                    padding: "10px 12px",
                                    borderRadius: "8px",
                                    background: item.status === "completed"
                                        ? "rgba(16, 185, 129, 0.06)"
                                        : item.status === "failed"
                                        ? "rgba(239, 68, 68, 0.06)"
                                        : "var(--bg-primary)",
                                    border: `1px solid ${
                                        item.status === "completed"
                                            ? "rgba(16, 185, 129, 0.2)"
                                            : item.status === "failed"
                                            ? "rgba(239, 68, 68, 0.2)"
                                            : "var(--glass-border)"
                                    }`,
                                }}
                            >
                                {getStatusIcon(item.status)}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div
                                        style={{
                                            fontSize: "0.8rem",
                                            fontWeight: 500,
                                            color: "var(--text-primary)",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "6px",
                                        }}
                                    >
                                        <span style={{ fontFamily: "monospace", fontSize: "0.75rem", opacity: 0.7 }}>
                                            {item.filename}
                                        </span>
                                        <span
                                            style={{
                                                fontSize: "0.6rem",
                                                padding: "1px 6px",
                                                borderRadius: "6px",
                                                fontWeight: 600,
                                                background: item.mode === "extract"
                                                    ? "rgba(16, 185, 129, 0.15)"
                                                    : "rgba(239, 68, 68, 0.15)",
                                                color: item.mode === "extract" ? "var(--ghost-success)" : "var(--ghost-error)",
                                            }}
                                        >
                                            {item.mode === "extract" ? "EXT" : "REM"}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                                        &ldquo;{item.description}&rdquo;
                                    </div>
                                    {item.error && (
                                        <div style={{ fontSize: "0.65rem", color: "var(--ghost-error)", marginTop: "2px" }}>
                                            ⚠ {item.error}
                                        </div>
                                    )}
                                </div>

                                {/* Progress bar for processing items */}
                                {item.status === "processing" && (
                                    <div
                                        style={{
                                            width: "60px",
                                            height: "4px",
                                            borderRadius: "2px",
                                            background: "var(--bg-tertiary)",
                                            overflow: "hidden",
                                            flexShrink: 0,
                                        }}
                                    >
                                        <div
                                            style={{
                                                height: "100%",
                                                borderRadius: "2px",
                                                background: "linear-gradient(90deg, var(--ghost-primary), var(--ghost-accent))",
                                                width: `${item.progress}%`,
                                                transition: "width 0.5s ease",
                                            }}
                                        />
                                    </div>
                                )}

                                {/* Remove button (only for pending items) */}
                                {item.status === "pending" && (
                                    <button
                                        onClick={() => removeItem(item.id)}
                                        style={{
                                            padding: "4px 8px",
                                            borderRadius: "6px",
                                            background: "transparent",
                                            color: "var(--text-muted)",
                                            border: "none",
                                            cursor: "pointer",
                                            fontSize: "0.7rem",
                                        }}
                                    >
                                        <Trash2 style={{ width: "12px", height: "12px" }} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Start Batch Button */}
                {pendingCount > 0 && (
                    <button
                        onClick={startBatch}
                        disabled={processing}
                        style={{
                            width: "100%",
                            marginTop: "16px",
                            padding: "12px",
                            borderRadius: "10px",
                            border: "none",
                            cursor: processing ? "not-allowed" : "pointer",
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            background: processing
                                ? "var(--bg-tertiary)"
                                : "linear-gradient(135deg, var(--ghost-primary), var(--ghost-accent))",
                            color: processing ? "var(--text-muted)" : "white",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "8px",
                            opacity: processing ? 0.6 : 1,
                        }}
                    >
                        {processing ? (
                            <>
                                <Loader style={{ width: "16px", height: "16px", animation: "spin 1s linear infinite" }} />
                                Processing...
                            </>
                        ) : (
                            <>
                                <Play style={{ width: "16px", height: "16px" }} />
                                Process {pendingCount} Item{pendingCount > 1 ? "s" : ""}
                            </>
                        )}
                    </button>
                )}
            </div>
        </div>
    );
}
