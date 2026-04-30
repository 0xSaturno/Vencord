/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { createRoot } from "@webpack/common";
import type { Root } from "react-dom/client";

import { ChannelTabsBar } from "./components";
import {
    closeTab,
    destroyStore,
    getState,
    initializeStore,
    nextTab,
    openNewTab,
    previousTab,
    toggleCompactStyle,
    toggleShowFavBar,
    toggleShowTabBar,
    toggleWrapTabs,
    updateCurrentTab,
} from "./store";

// =================== Settings ===================

const settings = definePluginSettings({
    showTabBar: {
        description: "Show the tab bar at the top of Discord",
        type: OptionType.BOOLEAN,
        default: true,
    },
    showFavBar: {
        description: "Show the favorites bar below the tab bar",
        type: OptionType.BOOLEAN,
        default: true,
    },
    compactStyle: {
        description: "Use a compact appearance for tabs",
        type: OptionType.BOOLEAN,
        default: false,
    },
    wrapTabs: {
        description: "Wrap tabs to the next line when they overflow",
        type: OptionType.BOOLEAN,
        default: false,
    },
    alwaysFocusNewTabs: {
        description: "Always focus newly created tabs",
        type: OptionType.BOOLEAN,
        default: true,
    },
});

// =================== Keybind Handler ===================

function keybindHandler(e: KeyboardEvent) {
    // Ctrl+T: New tab
    if (e.ctrlKey && e.key === "t") {
        e.preventDefault();
        e.stopPropagation();
        openNewTab();
    }
    // Ctrl+W: Close current tab
    if (e.ctrlKey && e.key === "w") {
        e.preventDefault();
        e.stopPropagation();
        const state = getState();
        const selectedIndex = state.tabs.findIndex(t => t.selected);
        if (state.tabs.length > 1 && selectedIndex >= 0) {
            closeTab(selectedIndex);
        }
    }
    // Ctrl+PageUp: Previous tab
    if (e.ctrlKey && e.key === "PageUp") {
        e.preventDefault();
        e.stopPropagation();
        previousTab();
    }
    // Ctrl+PageDown: Next tab
    if (e.ctrlKey && e.key === "PageDown") {
        e.preventDefault();
        e.stopPropagation();
        nextTab();
    }
}

// =================== DOM Injection Helpers ===================

const TAB_BAR_CONTAINER_ID = "vc-channeltabs-root";
let tabBarRoot: Root | null = null;

function injectTabBar() {
    // Don't double-inject
    if (document.getElementById(TAB_BAR_CONTAINER_ID)) return;

    console.log("[ChannelTabs] Attempting to inject tab bar...");

    const container = document.createElement("div");
    container.id = TAB_BAR_CONTAINER_ID;

    // Discord's actual DOM structure (confirmed via browser inspection):
    //
    // #app-mount (flex column)
    //   ├── <svg> (masks)
    //   ├── <svg> (gradients)
    //   ├── <div> (empty)
    //   ├── <div class="appAsidePanelWrapper_..."> (flex row)
    //   │     └── <div class="notAppAsidePanel_...">
    //   │           └── <div class="app_...">
    //   │                 └── <div class="app__..."> (flex COLUMN) ← TARGET
    //   │                       ├── <div class="bg__..."> (background)
    //   │                       └── <div class="layers__..."> (layers) ← ANCHOR
    //   ├── <div> (empty)
    //   └── <div> (empty)
    //
    // Desktop app may additionally have titleBar/notDevTools wrappers.
    // We find "layers" as anchor, then insert right before it in its parent.

    const layers = document.querySelector('[class*="layers_"]') as HTMLElement
        ?? document.querySelector('[class*="layers-"]') as HTMLElement;

    if (layers && layers.parentElement) {
        // Insert right before the layers element
        layers.parentElement.insertBefore(container, layers);
        console.log("[ChannelTabs] Inserted before layers. Parent:", layers.parentElement.className);
    } else {
        // Fallback: look for the app container by class pattern
        const appContainer = document.querySelector('[class*="app_"]') as HTMLElement;
        if (appContainer) {
            appContainer.prepend(container);
            console.log("[ChannelTabs] Fallback: prepended to app container:", appContainer.className);
        } else {
            console.log("[ChannelTabs] Could not find injection point, deferring...");
            return;
        }
    }

    // Render our React component into the container
    tabBarRoot = createRoot(container);
    tabBarRoot.render(
        <ErrorBoundary noop>
            <ChannelTabsBar />
        </ErrorBoundary>
    );
    console.log("[ChannelTabs] Tab bar rendered successfully.");
}

function removeTabBar() {
    if (tabBarRoot) {
        tabBarRoot.unmount();
        tabBarRoot = null;
    }
    const container = document.getElementById(TAB_BAR_CONTAINER_ID);
    if (container) {
        container.remove();
    }
}

// =================== Plugin Definition ===================

export default definePlugin({
    name: "ChannelTabs",
    description: "Adds browser-like tabs and bookmarks to Discord, allowing you to quickly switch between channels without losing your place.",
    authors: [{ name: "Saturn", id: 965286897662443570n }],
    settings,

    toolboxActions: {
        "Toggle Tab Bar": () => toggleShowTabBar(),
        "Toggle Favorites Bar": () => toggleShowFavBar(),
        "Toggle Compact Mode": () => toggleCompactStyle(),
        "Toggle Wrap Tabs": () => toggleWrapTabs(),
        "New Tab": () => openNewTab(),
    },

    async start() {
        await initializeStore();
        document.addEventListener("keydown", keybindHandler, true);

        // Try to inject immediately, and also watch for DOM changes
        // in case the app hasn't fully loaded yet
        injectTabBar();

        // Retry injection after delays in case DOM wasn't ready
        this._retryTimers = [
            setTimeout(() => injectTabBar(), 500),
            setTimeout(() => injectTabBar(), 1500),
            setTimeout(() => injectTabBar(), 3000),
        ];

        this._observer = new MutationObserver(() => {
            if (!document.getElementById(TAB_BAR_CONTAINER_ID)) {
                injectTabBar();
            }
        });

        this._observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        // Watch for navigation changes
        this._navInterval = setInterval(() => {
            updateCurrentTab();
        }, 1000);
    },

    stop() {
        document.removeEventListener("keydown", keybindHandler, true);
        destroyStore();
        removeTabBar();

        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }

        if (this._navInterval) {
            clearInterval(this._navInterval);
            this._navInterval = null;
        }

        if (this._retryTimers) {
            this._retryTimers.forEach(clearTimeout);
            this._retryTimers = null;
        }
    },

    // Flux subscription to listen for channel switch events
    flux: {
        CHANNEL_SELECT() {
            setTimeout(() => updateCurrentTab(), 100);
        },
    },
});

