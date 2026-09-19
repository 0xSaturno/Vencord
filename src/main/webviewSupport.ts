/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, WebContents } from "electron";

// Chromium's zoom step: zoomFactor = 1.2 ^ zoomLevel
const ZOOM_BASE = 1.2;

/**
 * Discord's Electron build lacks WebContents#getZoomFactor / setZoomFactor, but Electron's own
 * `zoomFactor` getter calls them. The guest view manager reads `embedder.zoomFactor` when creating
 * a <webview> guest, so every webview attach fails with "this.getZoomFactor is not a function".
 * Shim them on the shared prototype, deriving the factor from the zoom level where possible.
 */
function shimZoomFactor(wc: WebContents) {
    const shims: Record<string, Function> = {
        getZoomFactor(this: WebContents) {
            return typeof this.getZoomLevel === "function"
                ? Math.pow(ZOOM_BASE, this.getZoomLevel())
                : 1;
        },
        setZoomFactor(this: WebContents, factor: number) {
            if (typeof this.setZoomLevel === "function" && factor > 0)
                this.setZoomLevel(Math.log(factor) / Math.log(ZOOM_BASE));
        }
    };

    const instance = wc as any;
    const proto = Object.getPrototypeOf(wc);
    for (const [name, value] of Object.entries(shims)) {
        if (typeof instance[name] === "function") continue;

        // Patch the prototype so every WebContents (including guests) benefits,
        // and the instance too in case something shadows it there
        const descriptor = { value, configurable: true, writable: true };
        if (proto) Object.defineProperty(proto, name, descriptor);
        if (typeof instance[name] !== "function") Object.defineProperty(wc, name, descriptor);
    }
}

export function initWebviewSupport() {
    // Must be registered before Discord creates its window: web-contents-created fires
    // for every WebContents, including the main window that will embed our webviews
    app.on("web-contents-created", (_, wc) => {
        shimZoomFactor(wc);

        // Lock down any <webview> guest regardless of what the renderer requested
        wc.on("will-attach-webview", (_e, webPreferences) => {
            delete webPreferences.preload;
            webPreferences.nodeIntegration = false;
            webPreferences.nodeIntegrationInSubFrames = false;
            webPreferences.contextIsolation = true;
            webPreferences.sandbox = true;
        });

        if (wc.getType() === "webview") {
            // Keep popups / target=_blank links inside the webview instead of spawning windows
            wc.setWindowOpenHandler(({ url }) => {
                if (/^https?:/i.test(url)) wc.loadURL(url);
                return { action: "deny" };
            });
        }
    });
}
