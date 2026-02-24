/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { FluxDispatcher, UserStore } from "@webpack/common";

import type { NativeCursorInfo, NativeDisplayInfo } from "./native";

// =================== Native Bridge ===================

// This calls the functions exported from native.ts via Vencord's IPC system.
// native.ts runs in Electron's main process where screen APIs are available.
const Native = VencordNative.pluginHelpers.ScreenShareFollow as PluginNative<typeof import("./native")>;

// =================== Discord Internal Modules ===================

const ApplicationStreamingStore: any = findStoreLazy("ApplicationStreamingStore");

// =================== Types ===================

interface DesktopCapturerSource {
    id: string;     // e.g. "screen:0:0", "screen:1:0"
    name: string;   // e.g. "Screen 1", "Screen 2"
    url: string;    // thumbnail data URL
    icon?: string;
}

interface CachedStreamSettings {
    sound: boolean;
    qualityOptions: {
        preset: number;
        resolution: number;
        frameRate: number;
    };
}

interface SourceMapping {
    sourceId: string;           // desktopCapturer ID e.g. "screen:0:0"
    name: string;               // e.g. "Screen 1"
    displayIndex: number;       // index in displays array
    displayId?: number;         // Electron display ID
}

// =================== Source Enumeration & Mapping ===================

let sourceMappings: SourceMapping[] = [];
let displayList: NativeDisplayInfo[] = [];

/**
 * Enumerates available screen sources using Discord's native API
 * and correlates them with Electron display info for cursor tracking.
 */
async function buildSourceMappings(): Promise<void> {
    try {
        // Get desktopCapturer sources via DiscordNative
        const sources: DesktopCapturerSource[] = await (window as any).DiscordNative
            .desktopCapture.getDesktopCaptureSources({ types: ["screen"] });

        // Get Electron displays via our native IPC bridge
        displayList = await Native.getAllDisplays();

        sourceMappings = sources.map((source, i) => ({
            sourceId: source.id,
            name: source.name,
            displayIndex: i,
            displayId: displayList[i]?.id,
        }));

        console.log("[ScreenShareFollow] Source mappings:", sourceMappings.map(m => ({
            sourceId: m.sourceId,
            name: m.name,
            displayId: m.displayId,
            displayBounds: displayList[m.displayIndex]?.bounds,
        })));

    } catch (err) {
        console.error("[ScreenShareFollow] Failed to enumerate sources:", err);
        sourceMappings = [];
    }
}

/**
 * Given cursor info from the native bridge, find the source for that display.
 */
function getSourceForDisplay(cursorInfo: NativeCursorInfo): SourceMapping | null {
    // Match by display ID
    const byId = sourceMappings.find(m => m.displayId === cursorInfo.displayId);
    if (byId) return byId;

    // Fallback: match by cursor position within display bounds
    for (let i = 0; i < displayList.length; i++) {
        const b = displayList[i].bounds;
        if (cursorInfo.x >= b.x && cursorInfo.x < b.x + b.width &&
            cursorInfo.y >= b.y && cursorInfo.y < b.y + b.height) {
            return sourceMappings[i] ?? null;
        }
    }

    return null;
}

// =================== Source Switching ===================

let cachedStreamSettings: CachedStreamSettings | null = null;

/**
 * Dispatches the Flux event to switch the active Go Live source.
 * This is the same event Discord fires when you click "Switch Source".
 */
function switchToSource(sourceId: string): void {
    if (!cachedStreamSettings) {
        console.warn("[ScreenShareFollow] No cached stream settings — cannot switch.");
        return;
    }

    console.log(`[ScreenShareFollow] 🔄 Switching to source: ${sourceId}`);

    FluxDispatcher.dispatch({
        type: "MEDIA_ENGINE_SET_GO_LIVE_SOURCE",
        settings: {
            desktopSettings: {
                sourceId: sourceId,
                sound: cachedStreamSettings.sound,
            },
            qualityOptions: cachedStreamSettings.qualityOptions,
            context: "stream",
        },
    });
}

// =================== Polling & Debounce ===================

let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastSourceId: string | null = null;
let isStreaming = false;

let pendingSwitch: {
    sourceId: string;
    timer: ReturnType<typeof setTimeout>;
} | null = null;

/**
 * Poll function with debounce support.
 * Gets cursor position via native IPC, determines which source to use,
 * and triggers source switch with configurable delay.
 */
async function pollCursorPosition(): Promise<void> {
    if (!isStreaming) return;

    try {
        const cursorInfo = await Native.getCursorInfo();
        const source = getSourceForDisplay(cursorInfo);
        if (!source) return;

        const { sourceId } = source;
        const switchDelay = settings.store.switchDelayMs;

        // Same source as current — cancel any pending switch
        if (sourceId === lastSourceId) {
            if (pendingSwitch && pendingSwitch.sourceId !== sourceId) {
                clearTimeout(pendingSwitch.timer);
                pendingSwitch = null;
            }
            return;
        }

        // Already have a pending switch to this source — let timer run
        if (pendingSwitch && pendingSwitch.sourceId === sourceId) {
            return;
        }

        // Cancel any pending switch to a different source
        if (pendingSwitch) {
            clearTimeout(pendingSwitch.timer);
            pendingSwitch = null;
        }

        // No delay — switch immediately
        if (switchDelay <= 0) {
            switchToSource(sourceId);
            lastSourceId = sourceId;
            return;
        }

        // Schedule debounced switch
        pendingSwitch = {
            sourceId,
            timer: setTimeout(() => {
                console.log(`[ScreenShareFollow] Cursor on ${source.name} for ${switchDelay}ms — switching`);
                switchToSource(sourceId);
                lastSourceId = sourceId;
                pendingSwitch = null;
            }, switchDelay),
        };

    } catch (err) {
        console.error("[ScreenShareFollow] Poll error:", err);
    }
}

function startPolling(): void {
    if (pollInterval) return;

    const intervalMs = settings.store.pollIntervalMs;
    pollInterval = setInterval(pollCursorPosition, intervalMs);

    // Set initial source from cursor
    pollCursorPosition().then(() => {
        // After first poll, set lastSourceId so we don't immediately switch
        // (the user is already sharing the current screen)
    });

    console.log(`[ScreenShareFollow] ▶ Polling started (interval: ${intervalMs}ms, delay: ${settings.store.switchDelayMs}ms)`);
}

function stopPolling(): void {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    if (pendingSwitch) {
        clearTimeout(pendingSwitch.timer);
        pendingSwitch = null;
    }
    lastSourceId = null;
}

// =================== Stream Event Helpers ===================

function isOurStream(streamKey: string): boolean {
    const userId = UserStore.getCurrentUser()?.id;
    return !!userId && streamKey.endsWith(userId);
}

function isCurrentUserStreaming(): boolean {
    try {
        const userId = UserStore.getCurrentUser()?.id;
        if (!userId) return false;
        return !!ApplicationStreamingStore.getAnyStreamForUser(userId);
    } catch {
        return false;
    }
}

// =================== Settings ===================

const settings = definePluginSettings({
    enabled: {
        description: "Enable automatic screen switching based on mouse position",
        type: OptionType.BOOLEAN,
        default: true,
    },
    pollIntervalMs: {
        description: "How often to check cursor position (ms). Lower = faster but more CPU. Recommended: 200-500",
        type: OptionType.NUMBER,
        default: 300,
    },
    switchDelayMs: {
        description: "Cursor must stay on new monitor this long (ms) before switching. Prevents accidental switches.",
        type: OptionType.NUMBER,
        default: 500,
    },
});

// =================== Plugin Definition ===================

export default definePlugin({
    name: "ScreenShareFollow",
    description: "Automatically switches your shared screen to whichever monitor your mouse cursor is on",
    authors: [Devs.Saturn],
    settings,

    toolboxActions: {
        "Toggle Screen Follow": () => {
            settings.store.enabled = !settings.store.enabled;
            const state = settings.store.enabled ? "ENABLED" : "DISABLED";
            console.log(`[ScreenShareFollow] ${state}`);

            if (settings.store.enabled && isStreaming) {
                startPolling();
            } else {
                stopPolling();
            }
        },
    },

    async start() {
        // Test native bridge
        try {
            const displays = await Native.getAllDisplays();
            console.log(`[ScreenShareFollow] ✅ Native bridge working. Found ${displays.length} display(s):`,
                displays.map(d => ({ id: d.id, label: d.label, bounds: d.bounds }))
            );

            if (displays.length < 2) {
                console.warn("[ScreenShareFollow] Only 1 display detected — plugin inactive until 2+ displays connected.");
            }
        } catch (err) {
            console.error("[ScreenShareFollow] ❌ Native bridge failed:", err);
            return;
        }

        // Build source mappings
        await buildSourceMappings();

        // If already streaming, start tracking
        if (isCurrentUserStreaming() && settings.store.enabled) {
            console.log("[ScreenShareFollow] Already streaming — starting cursor tracking");
            isStreaming = true;
            startPolling();
        }
    },

    stop() {
        isStreaming = false;
        stopPolling();
        cachedStreamSettings = null;
        lastSourceId = null;
        sourceMappings = [];
        displayList = [];
    },

    flux: {
        // Capture stream settings when a stream starts or source changes
        MEDIA_ENGINE_SET_GO_LIVE_SOURCE(data: any) {
            const s = data?.settings;
            if (!s) return;

            cachedStreamSettings = {
                sound: s.desktopSettings?.sound ?? true,
                qualityOptions: s.qualityOptions ?? {
                    preset: 1,
                    resolution: 1080,
                    frameRate: 60,
                },
            };

            // Track the active source ID so we don't switch back to it
            if (s.desktopSettings?.sourceId) {
                lastSourceId = s.desktopSettings.sourceId;
            }

            console.log("[ScreenShareFollow] 📋 Cached stream settings:", cachedStreamSettings);
        },

        // Stream created — start polling
        STREAM_CREATE(data: any) {
            if (!isOurStream(data.streamKey)) return;
            if (!settings.store.enabled) return;

            console.log("[ScreenShareFollow] 🎬 Stream started — enabling cursor tracking");
            isStreaming = true;

            // Rebuild source mappings in case displays changed
            buildSourceMappings().then(() => {
                if (isStreaming) startPolling();
            });
        },

        // Stream ended — stop polling
        STREAM_DELETE(data: any) {
            if (!isOurStream(data.streamKey)) return;

            console.log("[ScreenShareFollow] ⏹ Stream ended — disabling cursor tracking");
            isStreaming = false;
            stopPolling();
        },
    },
});
