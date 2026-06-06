"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface SpectralAnalyzerProps {
    audioUrl?: string | null;
    taskId?: string;
    track?: "original" | "ghost" | "clean";
    width?: number;
    height?: number;
    colorScheme?: "classic" | "fire" | "cool";
    compact?: boolean;
    playbackTime?: number;
    isPlaying?: boolean;
    audioDuration?: number;
}

const COLOR_SCHEMES = {
    classic: [
        [0, 0, 0], [0, 0, 20], [0, 20, 80], [10, 60, 160],
        [40, 120, 220], [100, 180, 240], [160, 220, 200],
        [220, 240, 160], [240, 220, 80], [240, 180, 40],
        [240, 120, 40], [240, 60, 40], [200, 30, 60], [160, 20, 80],
    ],
    fire: [
        [0, 0, 0], [20, 0, 0], [80, 10, 0], [160, 30, 0],
        [220, 60, 0], [240, 100, 0], [240, 140, 20], [240, 180, 60],
        [255, 220, 100], [255, 240, 160], [255, 250, 220],
    ],
    cool: [
        [0, 0, 0], [0, 5, 30], [0, 15, 70], [0, 40, 130],
        [0, 80, 190], [20, 130, 220], [60, 170, 240],
        [120, 200, 240], [180, 220, 240], [220, 235, 240], [240, 245, 255],
    ],
};

function getColor(value: number, scheme: number[][]) {
    const clamped = Math.max(0, Math.min(1, value));
    const idx = clamped * (scheme.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, scheme.length - 1);
    const t = idx - lo;
    const cLo = scheme[lo];
    const cHi = scheme[hi];
    return [
        Math.round(cLo[0] + (cHi[0] - cLo[0]) * t),
        Math.round(cLo[1] + (cHi[1] - cLo[1]) * t),
        Math.round(cLo[2] + (cHi[2] - cLo[2]) * t),
    ];
}

// Parse server-side binary spectrogram format
// v2 format: <int32 version=2><int32 num_times><int32 num_freqs><int32 sample_rate><float32 data...>
// v1 format (legacy): <int32 num_times><int32 num_freqs><float32 data...>
function parseSpectrogramData(buffer: ArrayBuffer): { data: number[][], numFreqs: number, sampleRate: number } | null {
    try {
        const headerInt32 = new Int32Array(buffer.slice(0, 16));
        const firstVal = headerInt32[0];

        let version: number, numTimes: number, numFreqs: number, sampleRate: number, dataOffset: number;

        if (firstVal === 2) {
            version = 2;
            numTimes = headerInt32[1];
            numFreqs = headerInt32[2];
            sampleRate = headerInt32[3];
            dataOffset = 16;
        } else {
            version = 1;
            numTimes = firstVal;
            numFreqs = headerInt32[1];
            sampleRate = 16000;
            dataOffset = 8;
        }

        if (numTimes <= 0 || numFreqs <= 0 || numTimes > 10000 || numFreqs > 10000) {
            console.error("[SpectralAnalyzer] Invalid spectrogram dimensions:", numTimes, numFreqs);
            return null;
        }

        if (sampleRate <= 0 || sampleRate > 200000) {
            console.warn("[SpectralAnalyzer] Suspicious sample rate:", sampleRate, "— defaulting to 16000");
            sampleRate = 16000;
        }

        const floatData = new Float32Array(buffer.slice(dataOffset));
        const expected = numTimes * numFreqs;
        if (floatData.length !== expected) {
            console.error("[SpectralAnalyzer] Size mismatch:", floatData.length, "vs expected", expected);
            return null;
        }

        const data: number[][] = [];
        for (let t = 0; t < numTimes; t++) {
            const row: number[] = [];
            for (let f = 0; f < numFreqs; f++) {
                row.push(floatData[t * numFreqs + f]);
            }
            data.push(row);
        }

        const nyquist = sampleRate / 2;
        console.log(`[SpectralAnalyzer] Parsed v${version} spectrogram: ${numTimes}x${numFreqs}, sr=${sampleRate}Hz, nyquist=${nyquist}Hz`);

        return { data, numFreqs, sampleRate };
    } catch (e) {
        console.error("[SpectralAnalyzer] Failed to parse binary data:", e);
        return null;
    }
}

// Client-side FFT (fallback)
async function computeClientSpectrogram(audioUrl: string, onProgress?: (pct: number) => void): Promise<number[][] | null> {
    try {
        const res = await fetch(audioUrl);
        if (!res.ok) throw new Error("Failed to fetch audio");
        const arrayBuffer = await res.arrayBuffer();

        const audioCtx = new AudioContext();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);
        const totalSamples = audioBuffer.length;

        const fftSize = 2048;
        const hopSize = fftSize / 4;
        const numFreqBins = fftSize / 2 + 1;
        const numTimeFrames = Math.floor((totalSamples - fftSize) / hopSize) + 1;

        const maxTimeFrames = 1000;
        const step = Math.max(1, Math.floor(numTimeFrames / maxTimeFrames));
        const data: number[][] = [];

        const window = new Float32Array(fftSize);
        for (let i = 0; i < fftSize; i++) {
            window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
        }

        const totalFrames = Math.ceil(numTimeFrames / step);
        let processed = 0;

        for (let t = 0; t < numTimeFrames; t += step) {
            const startSample = t * hopSize;
            const frame = new Float32Array(fftSize);
            for (let i = 0; i < fftSize; i++) {
                if (startSample + i < totalSamples) {
                    frame[i] = channelData[startSample + i] * window[i];
                }
            }

            const reals = new Float64Array(numFreqBins);
            const imags = new Float64Array(numFreqBins);
            for (let k = 0; k < numFreqBins; k++) {
                let sumReal = 0, sumImag = 0;
                for (let n = 0; n < fftSize; n++) {
                    const angle = (2 * Math.PI * k * n) / fftSize;
                    sumReal += frame[n] * Math.cos(angle);
                    sumImag -= frame[n] * Math.sin(angle);
                }
                reals[k] = sumReal;
                imags[k] = sumImag;
            }

            const magnitudes: number[] = [];
            for (let k = 0; k < numFreqBins; k++) {
                const mag = Math.sqrt(reals[k] * reals[k] + imags[k] * imags[k]);
                const db = 20 * Math.log10(mag + 1e-10);
                magnitudes.push(Math.max(0, Math.min(1, (db + 100) / 100)));
            }
            data.push(magnitudes);

            processed++;
            onProgress?.(Math.round((processed / totalFrames) * 100));
        }

        audioCtx.close();
        return data;
    } catch (e) {
        console.error("[SpectralAnalyzer] Client FFT failed:", e);
        return null;
    }
}

// Global cache
const serverDataCache = new Map<string, { data: number[][]; numFreqs: number; sampleRate: number }>();

export default function SpectralAnalyzer({
    audioUrl,
    taskId,
    track = "original",
    width = 800,
    height = 300,
    colorScheme = "classic",
    compact = false,
    playbackTime = 0,
    isPlaying = false,
    audioDuration = 0,
}: SpectralAnalyzerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const [progress, setProgress] = useState(0);
    const [errorMsg, setErrorMsg] = useState("");
    const spectrogramData = useRef<number[][] | null>(null);
    const sampleRateRef = useRef<number>(16000);
    const renderedKey = useRef<string | null>(null);
    const scheme = COLOR_SCHEMES[colorScheme];
    const lastPlayheadX = useRef<number>(-1);

    const cacheKey = taskId ? `${taskId}:${track}` : null;

    const loadData = useCallback(async () => {
        if (cacheKey) {
            const cached = serverDataCache.get(cacheKey);
            if (cached) {
                spectrogramData.current = cached.data;
                sampleRateRef.current = cached.sampleRate;
                setStatus("ready");
                renderedKey.current = cacheKey;
                return;
            }

            setStatus("loading");
            setProgress(0);
            try {
                const url = `/api/tasks/${taskId}/spectrogram?track=${track}`;
                const res = await fetch(url);
                if (res.ok) {
                    const buffer = await res.arrayBuffer();
                    const parsed = parseSpectrogramData(buffer);
                    if (parsed) {
                        serverDataCache.set(cacheKey, parsed);
                        spectrogramData.current = parsed.data;
                        sampleRateRef.current = parsed.sampleRate;
                        setStatus("ready");
                        renderedKey.current = cacheKey;
                        return;
                    }
                }
            } catch (e) {
                console.warn("[SpectralAnalyzer] Server fetch failed, falling back to client", e);
            }
        }

        if (audioUrl) {
            setStatus("loading");
            setProgress(0);
            const data = await computeClientSpectrogram(audioUrl, setProgress);
            if (data) {
                spectrogramData.current = data;
                setStatus("ready");
            } else {
                setStatus("error");
                setErrorMsg("Gagal memproses spektogram");
            }
        }
    }, [cacheKey, taskId, track, audioUrl]);

    useEffect(() => {
        if (renderedKey.current === cacheKey && cacheKey) return;
        if (!taskId && !audioUrl) return;
        loadData();
    }, [cacheKey, taskId, track, audioUrl, loadData]);

    // Render spectrogram to canvas (base image — without playhead)
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !spectrogramData.current) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const data = spectrogramData.current;
        const numFreqs = data[0].length;
        const numTimes = data.length;

        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);

        const imgData = ctx.createImageData(width, height);
        for (let x = 0; x < width; x++) {
            const timeIdx = Math.floor((x / width) * numTimes);
            if (timeIdx >= numTimes) continue;

            for (let y = 0; y < height; y++) {
                const freqIdx = Math.floor(((height - y - 1) / height) * numFreqs);
                if (freqIdx >= numFreqs) continue;

                const value = data[timeIdx][freqIdx];
                const [r, g, b] = getColor(value, scheme);

                const pixelIdx = (y * width + x) * 4;
                imgData.data[pixelIdx] = r;
                imgData.data[pixelIdx + 1] = g;
                imgData.data[pixelIdx + 2] = b;
                imgData.data[pixelIdx + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);

        // Frequency axis labels
        const nyquist = sampleRateRef.current / 2;
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = `${compact ? "8" : "10"}px monospace`;

        const maxFreqLabel = Math.min(nyquist, 22000);
        const freqStep = maxFreqLabel <= 8000 ? 2000 : maxFreqLabel <= 12000 ? 2000 : maxFreqLabel <= 22000 ? 4000 : 8000;
        const freqLabels: number[] = [0];
        for (let f = freqStep; f <= maxFreqLabel; f += freqStep) {
            freqLabels.push(f);
        }
        if (freqLabels[freqLabels.length - 1] !== nyquist && nyquist > 0) {
            freqLabels.push(nyquist);
        }
        const displayLabels = compact ? freqLabels.filter((_, i) => i === 0 || i === Math.floor(freqLabels.length / 2) || i === freqLabels.length - 1) : freqLabels;

        for (const f of displayLabels) {
            const y = height - Math.floor((f / nyquist) * height) - 1;
            if (y > 0 && y < height) {
                const label = f >= 1000 ? `${Math.round(f/1000)}k` : `${f}`;
                ctx.fillText(label, width - (compact ? 40 : 55), y + 3);
                ctx.fillStyle = "rgba(255,255,255,0.15)";
                ctx.fillRect(0, y, width, 1);
                ctx.fillStyle = "rgba(255,255,255,0.5)";
            }
        }

        lastPlayheadX.current = -1;
    }, [spectrogramData.current, sampleRateRef.current, width, height, colorScheme, scheme, compact]);

    // ============================================
    // PLAYHEAD ANIMATION
    // ============================================
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !spectrogramData.current) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const data = spectrogramData.current;
        const numFreqs = data[0].length;
        const numTimes = data.length;

        // If audioDuration is 0 (this spectrogram is not selected for playhead),
        // erase any existing playhead line and return
        if (audioDuration <= 0) {
            if (lastPlayheadX.current >= 0 && lastPlayheadX.current < width) {
                const oldX = lastPlayheadX.current;
                for (let dx = -2; dx <= 2; dx++) {
                    const x = oldX + dx;
                    if (x < 0 || x >= width) continue;
                    const timeIdx = Math.floor((x / width) * numTimes);
                    if (timeIdx >= numTimes) continue;
                    for (let y = 0; y < height; y++) {
                        const freqIdx = Math.floor(((height - y - 1) / height) * numFreqs);
                        if (freqIdx >= numFreqs) continue;
                        const value = data[timeIdx][freqIdx];
                        const [r, g, b] = getColor(value, scheme);
                        ctx.fillStyle = `rgb(${r},${g},${b})`;
                        ctx.fillRect(x, y, 1, 1);
                    }
                }
                lastPlayheadX.current = -1;
            }
            return;
        }

        // Calculate playhead X position
        const playheadX = Math.floor((playbackTime / audioDuration) * width);

        // Skip if position hasn't changed
        if (playheadX === lastPlayheadX.current) return;

        // Erase old playhead line by redrawing the spectrogram column
        if (lastPlayheadX.current >= 0 && lastPlayheadX.current < width) {
            const oldX = lastPlayheadX.current;
            for (let dx = -2; dx <= 2; dx++) {
                const x = oldX + dx;
                if (x < 0 || x >= width) continue;
                const timeIdx = Math.floor((x / width) * numTimes);
                if (timeIdx >= numTimes) continue;
                for (let y = 0; y < height; y++) {
                    const freqIdx = Math.floor(((height - y - 1) / height) * numFreqs);
                    if (freqIdx >= numFreqs) continue;
                    const value = data[timeIdx][freqIdx];
                    const [r, g, b] = getColor(value, scheme);
                    ctx.fillStyle = `rgb(${r},${g},${b})`;
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }

        // Draw new playhead line with glow effect
        if (playheadX >= 0 && playheadX < width) {
            // Glow
            const gradient = ctx.createLinearGradient(playheadX - 4, 0, playheadX + 4, 0);
            gradient.addColorStop(0, "rgba(255,255,255,0)");
            gradient.addColorStop(0.3, "rgba(255,255,255,0.08)");
            gradient.addColorStop(0.5, "rgba(255,255,255,0.15)");
            gradient.addColorStop(0.7, "rgba(255,255,255,0.08)");
            gradient.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = gradient;
            ctx.fillRect(playheadX - 4, 0, 8, height);

            // Main line
            ctx.strokeStyle = isPlaying
                ? "rgba(255, 255, 255, 0.9)"
                : "rgba(255, 255, 255, 0.5)";
            ctx.lineWidth = isPlaying ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(playheadX, 0);
            ctx.lineTo(playheadX, height);
            ctx.stroke();

            // Small triangle indicator at top
            ctx.fillStyle = isPlaying ? "rgba(255, 255, 255, 0.9)" : "rgba(255, 255, 255, 0.6)";
            ctx.beginPath();
            ctx.moveTo(playheadX - 4, 0);
            ctx.lineTo(playheadX + 4, 0);
            ctx.lineTo(playheadX, 6);
            ctx.closePath();
            ctx.fill();
        }

        lastPlayheadX.current = playheadX;
    }, [playbackTime, isPlaying, audioDuration, width, height, scheme]);

    return (
        <div>
            <div
                style={{
                    position: "relative",
                    borderRadius: compact ? "8px" : "12px",
                    overflow: "hidden",
                    border: "1px solid var(--glass-border)",
                    background: "#000",
                }}
            >
                <canvas
                    ref={canvasRef}
                    width={width}
                    height={height}
                    style={{
                        width: "100%",
                        height: "auto",
                        display: "block",
                        aspectRatio: `${width}/${height}`,
                    }}
                />

                {/* Loading overlay */}
                {status === "loading" && (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(0,0,0,0.7)",
                            gap: "12px",
                        }}
                    >
                        <div
                            style={{
                                width: "32px",
                                height: "32px",
                                border: "3px solid rgba(255,255,255,0.2)",
                                borderTop: "3px solid var(--ghost-primary)",
                                borderRadius: "50%",
                                animation: "spin 1s linear infinite",
                            }}
                        />
                        <span style={{ color: "white", fontSize: compact ? "0.7rem" : "0.8rem" }}>
                            {taskId ? "Loading spectrogram..." : `Analyzing spectrum... ${progress}%`}
                        </span>
                    </div>
                )}

                {/* Error overlay */}
                {status === "error" && (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(0,0,0,0.7)",
                            color: "#F472B6",
                            fontSize: compact ? "0.75rem" : "0.85rem",
                        }}
                    >
                        ⚠️ {errorMsg || "Failed to load spectrogram"}
                    </div>
                )}

                {/* "No data" overlay */}
                {status === "idle" && (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "rgba(0,0,0,0.3)",
                            color: "rgba(255,255,255,0.4)",
                            fontSize: compact ? "0.7rem" : "0.85rem",
                        }}
                    >
                        No audio data
                    </div>
                )}

                {/* Labels */}
                {!compact && (
                    <>
                        <div style={{ position: "absolute", top: "8px", left: "10px", fontSize: "0.65rem", color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>
                            Freq (Hz)
                        </div>
                        <div style={{ position: "absolute", bottom: "8px", left: "10px", fontSize: "0.65rem", color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>
                            0Hz
                        </div>
                        <div style={{ position: "absolute", bottom: "8px", right: "10px", fontSize: "0.65rem", color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>
                            {sampleRateRef.current ? `${Math.round(sampleRateRef.current / 2 / 1000)}kHz` : '8kHz'}
                        </div>
                    </>
                )}
            </div>

            {/* Color Legend */}
            {status === "ready" && !compact && (
                <div
                    style={{
                        marginTop: "10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--glass-border)",
                    }}
                    role="img"
                    aria-label="Color legend"
                >
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                        <div style={{
                            width: "12px", height: "12px",
                            borderRadius: "2px",
                            background: "#000",
                            border: "1px solid rgba(255,255,255,0.2)",
                        }} />
                        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                            Quiet / Empty
                        </span>
                    </div>

                    <div
                        style={{
                            flex: 1,
                            height: "14px",
                            borderRadius: "3px",
                            background: "linear-gradient(to right, #000, #001450, #0a3c8a, #2a7ab0, #5ab8c0, #8ad880, #c8e848, #f0c828, #f08018, #d03018)",
                            border: "1px solid rgba(255,255,255,0.2)",
                            minWidth: "80px",
                            position: "relative",
                        }}
                    >
                        <div style={{ position: "absolute", top: 0, left: "25%", width: "1px", height: "100%", background: "rgba(255,255,255,0.3)" }} />
                        <div style={{ position: "absolute", top: 0, left: "50%", width: "1px", height: "100%", background: "rgba(255,255,255,0.3)" }} />
                        <div style={{ position: "absolute", top: 0, left: "75%", width: "1px", height: "100%", background: "rgba(255,255,255,0.3)" }} />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                            <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.4)", lineHeight: 1 }}>- - -</span>
                            <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>weak</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                            <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.7)", lineHeight: 1, fontWeight: 600 }}>&mdash;&mdash;</span>
                            <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>strong</span>
                        </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                        <div style={{
                            width: "12px", height: "12px",
                            borderRadius: "2px",
                            background: "#d03018",
                            border: "1px solid rgba(255,255,255,0.2)",
                        }} />
                        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                            Loud / Dense
                        </span>
                    </div>
                </div>
            )}

            {!compact && status === "ready" && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                    <span>Higher frequencies (treble)</span>
                    <span>Time (left = start, right = end)</span>
                    <span>Lower frequencies (bass)</span>
                </div>
            )}
        </div>
    );
}
