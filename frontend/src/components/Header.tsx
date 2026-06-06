"use client";

import { Sun, Moon, Clock, Server } from "lucide-react";

interface HeaderProps {
    isDarkMode: boolean;
    onThemeToggle: () => void;
    onLogoClick?: () => void;
    onHistoryClick?: () => void;
}

export default function Header({
    isDarkMode,
    onThemeToggle,
    onLogoClick,
    onHistoryClick,
}: HeaderProps) {
    return (
        <header
            className="sticky top-0 z-50 glass-card"
            style={{
                borderRadius: 0,
                borderTop: "none",
                borderLeft: "none",
                borderRight: "none",
                width: "100%",
            }}
        >
            <div
                style={{
                    maxWidth: "1200px",
                    margin: "0 auto",
                    padding: "16px 24px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                }}
            >
                {/* Logo - Clickable */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        cursor: onLogoClick ? "pointer" : "default"
                    }}
                    onClick={onLogoClick}
                    title="Return to home"
                >
                    <img
                        src="/audioghost_logo.png"
                        alt="Audio Archive Restoration Logo"
                        style={{
                            width: "40px",
                            height: "40px",
                            borderRadius: "10px"
                        }}
                    />
                    <div>
                        <h1 style={{ fontWeight: 700, fontSize: "1.125rem", color: "var(--text-primary)" }}>
                            Audio Archive <span className="gradient-text">Restoration</span>
                        </h1>
                        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            v1.0 MVP
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {/* History Button */}
                    <button
                        onClick={onHistoryClick}
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
                            transition: "all 0.2s ease"
                        }}
                        title="Riwayat Restorasi"
                        onMouseOver={(e) => { e.currentTarget.style.background = "var(--bg-secondary)"; }}
                        onMouseOut={(e) => { e.currentTarget.style.background = "var(--bg-tertiary)"; }}
                    >
                        <Clock style={{ width: "16px", height: "16px" }} />
                        <span>Riwayat</span>
                    </button>

                    {/* Theme Toggle */}
                    <button
                        onClick={onThemeToggle}
                        style={{
                            padding: "8px",
                            borderRadius: "8px",
                            background: "var(--bg-tertiary)",
                            color: "var(--text-secondary)",
                            border: "none",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "all 0.3s ease"
                        }}
                        title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                    >
                        {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                    </button>

                    {/* Admin Button */}
                    <a
                        href="/admin"
                        style={{
                            padding: "8px 12px",
                            borderRadius: "8px",
                            background: "var(--bg-tertiary)",
                            color: "var(--text-secondary)",
                            border: "none",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "0.875rem",
                            textDecoration: "none",
                            transition: "all 0.2s ease"
                        }}
                        title="Admin Panel"
                    >
                        <Server style={{ width: "16px", height: "16px" }} />
                        <span>Admin</span>
                    </a>

                    {/* HuggingFace status - always connected via system token */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "8px 16px",
                            borderRadius: "8px",
                            background: "var(--bg-tertiary)"
                        }}
                    >
                        <div
                            style={{
                                width: "8px",
                                height: "8px",
                                borderRadius: "50%",
                                background: "var(--ghost-success)"
                            }}
                        />
                        <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>HF Connected</span>
                    </div>
                </div>
            </div>
        </header>
    );

}
