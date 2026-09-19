/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { createRoot, Menu } from "@webpack/common";
import type { Root } from "react-dom/client";

import { openSideBrowser, SideBrowser, toggleSideBrowser } from "./components/SideBrowser";
import { settings } from "./settings";

const CONTAINER_ID = "vc-sidebrowser-root";
let browserRoot: Root | null = null;
let keybindHandler: ((e: KeyboardEvent) => void) | null = null;

const KEY_EVENTS = ["keydown", "keypress", "keyup"] as const;

// Discord moves focus to the chat box when you type while no text field is focused. Keys typed into
// the webview (or omnibar) bubble up to Discord's document, so keep them from ever reaching its handlers
function isolateBrowserKeys(e: KeyboardEvent) {
    const target = e.target as Node | null;
    if (target && document.getElementById(CONTAINER_ID)?.contains(target))
        e.stopPropagation();
}

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    const href: string | undefined = props?.itemHref;
    if (!href || !/^https?:\/\//i.test(href)) return;

    const item = (
        <Menu.MenuItem
            id="vc-sidebrowser-open-link"
            label="Open In SideBrowser"
            action={() => openSideBrowser(href)}
        />
    );

    const group = findGroupChildrenByChildId("copy-link", children);
    if (group) group.push(item);
    else children.push(<Menu.MenuGroup>{item}</Menu.MenuGroup>);
};

function injectContainer() {
    if (document.getElementById(CONTAINER_ID)) return;

    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    document.body.appendChild(container);

    browserRoot = createRoot(container);
    browserRoot.render(
        <ErrorBoundary noop>
            <SideBrowser />
        </ErrorBoundary>
    );
}

function removeContainer() {
    if (browserRoot) {
        browserRoot.unmount();
        browserRoot = null;
    }
    const container = document.getElementById(CONTAINER_ID);
    if (container) {
        container.remove();
    }
}

export default definePlugin({
    name: "SideBrowser",
    description: "Adds a sleek, collapsible side panel web browser inside Discord with navigation, search, and bookmarks.",
    authors: [{ name: "User", id: 0n }],
    tags: ["Utility"],
    settings,

    contextMenus: {
        "message": messageContextMenuPatch,
    },

    toolboxActions: {
        "Toggle Side Browser": () => toggleSideBrowser(),
    },

    start() {
        injectContainer();

        keybindHandler = (e: KeyboardEvent) => {
            // Check for Ctrl+Shift+B or Alt+B
            if (
                (e.ctrlKey && e.shiftKey && (e.key === "b" || e.key === "B")) ||
                (e.altKey && (e.key === "b" || e.key === "B"))
            ) {
                e.preventDefault();
                e.stopPropagation();
                toggleSideBrowser();
            }
        };

        window.addEventListener("keydown", keybindHandler, true);
        for (const type of KEY_EVENTS)
            window.addEventListener(type, isolateBrowserKeys, true);
    },

    stop() {
        for (const type of KEY_EVENTS)
            window.removeEventListener(type, isolateBrowserKeys, true);
        if (keybindHandler) {
            window.removeEventListener("keydown", keybindHandler, true);
            keybindHandler = null;
        }
        removeContainer();
    },
});
