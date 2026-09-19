/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { makeRange, OptionType } from "@utils/types";

export const settings = definePluginSettings({
    homeUrl: {
        description: "Homepage URL loaded when clicking the home button or opening a new session",
        type: OptionType.STRING,
        default: "https://duckduckgo.com",
    },
    searchEngine: {
        description: "Search engine used when searching from the omnibar",
        type: OptionType.SELECT,
        options: [
            { label: "DuckDuckGo", value: "https://duckduckgo.com/?q=" },
            { label: "Google", value: "https://www.google.com/search?q=" },
            { label: "Bing", value: "https://www.bing.com/search?q=" },
            { label: "Brave Search", value: "https://search.brave.com/search?q=" },
            { label: "Ecosia", value: "https://www.ecosia.org/search?q=" },
        ],
        default: "https://duckduckgo.com/?q=",
    },
    defaultWidth: {
        description: "Initial width of the browser side panel in pixels",
        type: OptionType.NUMBER,
        default: 480,
    },
    volume: {
        description: "Volume of audio and video played in the side browser",
        type: OptionType.SLIDER,
        markers: makeRange(0, 100, 10),
        default: 100,
        stickToMarkers: false,
    },
    mobileWidth: {
        description: "Load mobile versions of sites when the panel is narrower than this many pixels (0 to disable)",
        type: OptionType.NUMBER,
        default: 540,
    },
    showEdgeTab: {
        description: "Show a floating toggle tab on the right edge of Discord",
        type: OptionType.BOOLEAN,
        default: true,
    },
    showBookmarks: {
        description: "Show the quick bookmarks toolbar below the address bar",
        type: OptionType.BOOLEAN,
        default: true,
    },
});
