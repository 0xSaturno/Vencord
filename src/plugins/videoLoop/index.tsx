/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    loopByDefault: {
        description: "Automatically loop all videos by default",
        type: OptionType.BOOLEAN,
        default: true,
    },
});

const LOOP_BTN_CLASS = "vc-videoloop-btn";

function createLoopIcon(active: boolean): string {
    const color = active ? "#fff" : "rgba(255,255,255,0.5)";
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7z" fill="${color}"/>
        <path d="M17 17H7v-3l-4 4 4 4v-3h12v-6h-2v4z" fill="${color}"/>
    </svg>`;
}

function injectLoopButton(video: HTMLVideoElement) {
    // Don't inject twice
    if (video.dataset.vcLoopInjected) return;
    video.dataset.vcLoopInjected = "true";

    // Ignore streams (screenshares, camera streams)
    if (video.srcObject) return;

    // Ignore videos specifically sourced from Discord's UI asset endpoints
    const src = (video.src || video.currentSrc || "").toLowerCase();
    if (
        src.includes("nameplate") ||
        src.includes("avatar-decoration") ||
        src.includes("profile-effect")
    ) return;

    // Ignore animated profile UI elements (nameplates, avatar decorations, profile effects)
    if (video.closest('svg, [class*="nameplate"], [class*="avatarDecoration"], [class*="profileEffects"], [class^="panels_"], [class*=" panels_"], [class*="sidebar_"], [class*="userPopout"], [class*="userProfile"], [class*="accountProfile"]')) return;

    // Apply default loop setting
    if (settings.store.loopByDefault) {
        video.loop = true;
    }

    const parent = video.parentElement;
    if (!parent) return;

    // Create an overlay container positioned on top of the video
    const overlay = document.createElement("div");
    overlay.className = "vc-videoloop-overlay";
    overlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 9999;
    `;

    // Create the loop toggle button
    const btn = document.createElement("button");
    btn.className = LOOP_BTN_CLASS;
    btn.title = video.loop ? "Looping (click to disable)" : "Loop (click to enable)";
    btn.innerHTML = createLoopIcon(video.loop);

    btn.addEventListener("click", e => {
        e.stopPropagation();
        e.preventDefault();
        video.loop = !video.loop;
        btn.innerHTML = createLoopIcon(video.loop);
        btn.title = video.loop ? "Looping (click to disable)" : "Loop (click to enable)";
    });

    btn.style.cssText = `
        position: absolute;
        bottom: 36px;
        right: 8px;
        z-index: 9999;
        background: rgba(0, 0, 0, 0.7);
        border: none;
        border-radius: 4px;
        padding: 4px 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        opacity: 0;
        transition: opacity 0.15s ease;
    `;

    // Show/hide with hover on the video container — matches native controls
    parent.addEventListener("mouseenter", () => {
        btn.style.opacity = video.loop ? "1" : "0.6";
    });
    parent.addEventListener("mouseleave", () => {
        btn.style.opacity = "0";
    });

    overlay.appendChild(btn);

    // Ensure parent can hold absolute children
    const parentPosition = getComputedStyle(parent).position;
    if (parentPosition === "static" || parentPosition === "") {
        parent.style.position = "relative";
    }

    parent.appendChild(overlay);
}

let observer: MutationObserver | null = null;

function processExistingVideos() {
    document.querySelectorAll("video").forEach(v => injectLoopButton(v as HTMLVideoElement));
}

export default definePlugin({
    name: "VideoLoop",
    description: "Adds a loop toggle button to video embeds so you can replay them endlessly",
    authors: [Devs.Ven], // Replace with your own author entry if submitting
    settings,

    start() {
        // Process any videos already on screen
        processExistingVideos();

        // Watch for new video elements being added to the DOM
        observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;

                    // Direct video element
                    if (node.tagName === "VIDEO") {
                        injectLoopButton(node as HTMLVideoElement);
                        continue;
                    }

                    // Videos nested inside added containers
                    node.querySelectorAll?.("video").forEach(v =>
                        injectLoopButton(v as HTMLVideoElement)
                    );
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    },

    stop() {
        // Disconnect observer
        observer?.disconnect();
        observer = null;

        // Remove all injected overlays and buttons
        document.querySelectorAll(".vc-videoloop-overlay").forEach(el => el.remove());
        document.querySelectorAll(`.${LOOP_BTN_CLASS}`).forEach(el => el.remove());

        // Clean loop state from videos
        document.querySelectorAll("video").forEach(v => {
            delete (v as HTMLVideoElement).dataset.vcLoopInjected;
            (v as HTMLVideoElement).loop = false;
        });
    },
});
