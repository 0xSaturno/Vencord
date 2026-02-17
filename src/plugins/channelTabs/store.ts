/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavigationRouter, React, SelectedChannelStore } from "@webpack/common";

import { FavData, getCurrentName, loadDataAsync, saveData, TabData } from "./utils";

// =================== Global State ===================

let globalState = {
    tabs: [] as TabData[],
    favs: [] as FavData[],
    showTabBar: true,
    showFavBar: true,
    compactStyle: false,
    wrapTabs: false,
    alwaysFocusNewTabs: true,
};

let listeners: Set<() => void> = new Set();
let initialized = false;

function notifyListeners() {
    listeners.forEach(l => l());
}

function setState(partial: Partial<typeof globalState>) {
    globalState = { ...globalState, ...partial };
    notifyListeners();
    if (initialized) {
        persistState();
    }
}

function persistState() {
    saveData("tabs", globalState.tabs);
    saveData("favs", globalState.favs);
    saveData("settings", {
        showTabBar: globalState.showTabBar,
        showFavBar: globalState.showFavBar,
        compactStyle: globalState.compactStyle,
        wrapTabs: globalState.wrapTabs,
        alwaysFocusNewTabs: globalState.alwaysFocusNewTabs,
    });
}

// =================== Initialization ===================

export async function initializeStore() {
    // Load all data from DataStore (async) into the in-memory cache first
    const tabs = await loadDataAsync<TabData[]>("tabs", []);
    const favs = await loadDataAsync<FavData[]>("favs", []);
    const settings = await loadDataAsync("settings", {
        showTabBar: true,
        showFavBar: true,
        compactStyle: false,
        wrapTabs: false,
        alwaysFocusNewTabs: true,
    });

    // Ensure at least one tab exists
    if (tabs.length === 0) {
        tabs.push({
            name: getCurrentName(),
            url: location.pathname,
            channelId: SelectedChannelStore.getChannelId(),
            guildId: null,
            selected: true,
        });
    }

    // Ensure exactly one tab is selected
    const hasSelected = tabs.some(t => t.selected);
    if (!hasSelected && tabs.length > 0) {
        tabs[0].selected = true;
    }

    globalState = {
        tabs,
        favs,
        ...settings,
    };
    initialized = true;
    notifyListeners();
    persistState();
}

export function destroyStore() {
    listeners.clear();
}

// =================== Actions ===================

function switchToTab(index: number) {
    const tabs = globalState.tabs.map((tab, i) => ({
        ...tab,
        selected: i === index,
    }));

    const target = tabs[index];
    setState({ tabs });

    if (target?.url) {
        NavigationRouter.transitionTo(target.url);
    }
}

function openNewTab() {
    const currentName = getCurrentName();
    const currentUrl = location.pathname;
    const currentChannelId = SelectedChannelStore.getChannelId();

    let tabs: TabData[];

    if (globalState.alwaysFocusNewTabs) {
        tabs = [
            ...globalState.tabs.map(t => ({ ...t, selected: false })),
            {
                name: currentName,
                url: currentUrl,
                channelId: currentChannelId,
                guildId: null,
                selected: true,
            },
        ];
    } else {
        tabs = [
            ...globalState.tabs,
            {
                name: currentName,
                url: currentUrl,
                channelId: currentChannelId,
                guildId: null,
                selected: false,
            },
        ];
    }

    setState({ tabs });
}

function closeTab(index: number, mode: "single" | "other" | "left" | "right" = "single") {
    let tabs = [...globalState.tabs];
    const wasSelected = tabs[index]?.selected;

    switch (mode) {
        case "single":
            if (tabs.length <= 1) return;
            tabs.splice(index, 1);
            break;
        case "other":
            tabs = [tabs[index]];
            break;
        case "left":
            tabs = tabs.slice(index);
            break;
        case "right":
            tabs = tabs.slice(0, index + 1);
            break;
    }

    // If the selected tab was removed, select a nearby one
    if (wasSelected || !tabs.some(t => t.selected)) {
        const newIndex = Math.min(index, tabs.length - 1);
        tabs = tabs.map((t, i) => ({ ...t, selected: i === newIndex }));

        const newSelected = tabs.find(t => t.selected);
        if (newSelected?.url) {
            NavigationRouter.transitionTo(newSelected.url);
        }
    }

    setState({ tabs });
}

function moveTab(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const tabs = [...globalState.tabs];
    const [moved] = tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, moved);
    setState({ tabs });
}

function updateCurrentTab() {
    const currentUrl = location.pathname;
    const currentName = getCurrentName();
    const currentChannelId = SelectedChannelStore.getChannelId();

    const tabs = globalState.tabs.map(tab => {
        if (tab.selected) {
            return {
                ...tab,
                name: currentName,
                url: currentUrl,
                channelId: currentChannelId,
            };
        }
        return tab;
    });

    setState({ tabs });
}

// =================== Favorites Actions ===================

function addToFavs(name: string, url: string, channelId: string | null) {
    const favs = [
        ...globalState.favs,
        { name, url, channelId },
    ];
    setState({ favs });
}

function removeFav(index: number) {
    const favs = globalState.favs.filter((_, i) => i !== index);
    setState({ favs });
}

function openFavInNewTab(fav: FavData) {
    // If the fav's URL is already open in a tab, just switch to it
    const existingIndex = globalState.tabs.findIndex(t => t.url === fav.url);
    if (existingIndex !== -1) {
        switchToTab(existingIndex);
        return;
    }

    // Otherwise, create a new tab
    const tabs = [
        ...globalState.tabs.map(t => ({ ...t, selected: false })),
        {
            name: fav.name,
            url: fav.url,
            channelId: fav.channelId,
            guildId: fav.guildId || null,
            selected: true,
        },
    ];

    setState({ tabs });
    if (fav.url) {
        NavigationRouter.transitionTo(fav.url);
    }
}

// =================== Settings Actions ===================

function toggleShowTabBar() {
    setState({ showTabBar: !globalState.showTabBar });
}

function toggleShowFavBar() {
    setState({ showFavBar: !globalState.showFavBar });
}

function toggleCompactStyle() {
    setState({ compactStyle: !globalState.compactStyle });
}

function toggleWrapTabs() {
    setState({ wrapTabs: !globalState.wrapTabs });
}

// =================== Navigation Functions ===================

function nextTab() {
    const currentIndex = globalState.tabs.findIndex(t => t.selected);
    const nextIndex = (currentIndex + 1) % globalState.tabs.length;
    switchToTab(nextIndex);
}

function previousTab() {
    const currentIndex = globalState.tabs.findIndex(t => t.selected);
    const prevIndex = (currentIndex - 1 + globalState.tabs.length) % globalState.tabs.length;
    switchToTab(prevIndex);
}

// =================== Hook ===================

export function useTabStore() {
    const [, forceUpdate] = React.useState(0);

    React.useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);

    return {
        tabs: globalState.tabs,
        favs: globalState.favs,
        showTabBar: globalState.showTabBar,
        showFavBar: globalState.showFavBar,
        compactStyle: globalState.compactStyle,
        wrapTabs: globalState.wrapTabs,
        alwaysFocusNewTabs: globalState.alwaysFocusNewTabs,
        selectedTabIndex: globalState.tabs.findIndex(t => t.selected),

        // Tab actions
        switchToTab,
        openNewTab,
        closeTab,
        moveTab,
        updateCurrentTab,
        nextTab,
        previousTab,

        // Favorites actions
        addToFavs,
        removeFav,
        openFavInNewTab,

        // Settings
        toggleShowTabBar,
        toggleShowFavBar,
        toggleCompactStyle,
        toggleWrapTabs,
    };
}

// =================== Export getters for non-React contexts ===================

export function getState() {
    return globalState;
}

export {
    addToFavs,
    closeTab,
    nextTab,
    openNewTab,
    previousTab,
    toggleCompactStyle,
    toggleShowFavBar,
    toggleShowTabBar,
    toggleWrapTabs,
    updateCurrentTab,
};
