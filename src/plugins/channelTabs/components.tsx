/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@api/Styles";
import { React, ReactDOM, Tooltip, useEffect, useRef, useState } from "@webpack/common";

import { useTabStore } from "./store";
import { FavData, getIconFallback, getIconUrl } from "./utils";

const cl = classNameFactory("vc-channeltabs-");

// =================== SVG Icons ===================

function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14">
            <path
                fill="currentColor"
                d="M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z"
            />
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18">
            <path
                fill="currentColor"
                d="M13 6a1 1 0 1 0-2 0v5H6a1 1 0 1 0 0 2h5v5a1 1 0 1 0 2 0v-5h5a1 1 0 1 0 0-2h-5V6Z"
            />
        </svg>
    );
}

// =================== Native Context Menu ===================

interface ContextMenuItem {
    label: string;
    action: () => void;
    danger?: boolean;
    disabled?: boolean;
}

interface ContextMenuState {
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
}

function NativeContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void; }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("mousedown", handleClick);
        document.addEventListener("keydown", handleEsc);
        return () => {
            document.removeEventListener("mousedown", handleClick);
            document.removeEventListener("keydown", handleEsc);
        };
    }, [onClose]);

    if (!state.visible) return null;

    return ReactDOM.createPortal(
        <div
            ref={ref}
            className={cl("contextMenu")}
            style={{ left: state.x, top: state.y }}
        >
            {state.items.map((item, i) => (
                <div
                    key={i}
                    className={`${cl("contextMenuItem")} ${item.danger ? cl("contextMenuDanger") : ""} ${item.disabled ? cl("contextMenuDisabled") : ""}`}
                    onMouseDown={(e) => {
                        if (!item.disabled) {
                            e.stopPropagation();
                            item.action();
                            onClose();
                        }
                    }}
                >
                    {item.label}
                </div>
            ))}
        </div>,
        document.body
    );
}

// =================== Tab Icon Component ===================

function TabIcon({ url, name }: { url: string; name: string; }) {
    const iconUrl = getIconUrl(url);
    const fallback = getIconFallback(name);

    if (iconUrl) {
        return <img className={cl("tabIcon")} src={iconUrl} alt="" />;
    }

    return <div className={cl("tabIconText")}>{fallback}</div>;
}

// =================== Single Tab Component ===================

function Tab({ tab, index, onContextMenu }: { tab: any; index: number; onContextMenu: (e: React.MouseEvent, index: number) => void; }) {
    const { switchToTab, closeTab, tabs, moveTab } = useTabStore();
    const isSelected = tab.selected;
    const tabCount = tabs.length;
    const [dragOver, setDragOver] = useState(false);

    const handleClick = (e: React.MouseEvent) => {
        e.preventDefault();
        switchToTab(index);
    };

    const handleMiddleClick = (e: React.MouseEvent) => {
        if (e.button === 1) {
            e.preventDefault();
            if (tabCount > 1) {
                closeTab(index);
            }
        }
    };

    const handleClose = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (tabCount > 1) {
            closeTab(index);
        }
    };

    const handleDragStart = (e: React.DragEvent) => {
        e.dataTransfer.setData("text/plain", String(index));
        e.dataTransfer.effectAllowed = "move";
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOver(true);
    };

    const handleDragLeave = () => {
        setDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const fromIndex = parseInt(e.dataTransfer.getData("text/plain"));
        if (!isNaN(fromIndex) && fromIndex !== index) {
            moveTab(fromIndex, index);
        }
    };

    const className = [
        cl("tab"),
        isSelected && cl("selected"),
        dragOver && cl("dragOver"),
    ].filter(Boolean).join(" ");

    return (
        <Tooltip text={tab.name} position="bottom">
            {(tooltipProps: any) => (
                <div
                    {...tooltipProps}
                    className={className}
                    onClick={handleClick}
                    onMouseDown={handleMiddleClick}
                    onContextMenu={(e: React.MouseEvent) => onContextMenu(e, index)}
                    draggable
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div>
                        <TabIcon url={tab.url} name={tab.name} />
                        <span className={cl("tabName")}>{tab.name}</span>
                    </div>
                    {tabCount > 1 && (
                        <div className={cl("closeTab")} onClick={handleClose}>
                            <CloseIcon />
                        </div>
                    )}
                </div>
            )}
        </Tooltip>
    );
}

// =================== Pin Icon ===================

function PinIcon() {
    return (
        <svg viewBox="0 0 24 24" width="12" height="12">
            <path
                fill="currentColor"
                d="M19.3 5.71a.996.996 0 0 0 0-1.41l-.71-.71a.996.996 0 0 0-1.41 0L14 6.77l-1.06-1.06a.5.5 0 0 0-.7 0L10.7 7.24a.75.75 0 0 0 0 1.06l.35.36-3.54 3.54-.35-.36a.75.75 0 0 0-1.06 0l-1.77 1.77a.5.5 0 0 0 0 .7l2.83 2.83-4.24 4.24a.996.996 0 1 0 1.41 1.41l4.24-4.24 2.83 2.83a.5.5 0 0 0 .7 0l1.77-1.77a.75.75 0 0 0 0-1.06l-.35-.36 3.54-3.54.35.36a.75.75 0 0 0 1.06 0l1.54-1.54a.5.5 0 0 0 0-.7L17.23 10l2.07-4.29Z"
            />
        </svg>
    );
}

// =================== Pinned Favourite (inline in tab bar) ===================

function PinnedFav({ fav, index, onContextMenu }: { fav: FavData; index: number; onContextMenu: (e: React.MouseEvent, index: number) => void; }) {
    const { openFavInNewTab, tabs } = useTabStore();
    const isSelected = tabs.some(t => t.selected && t.url === fav.url);

    const handleClick = () => {
        openFavInNewTab(fav);
    };

    const iconUrl = getIconUrl(fav.url);
    const fallback = getIconFallback(fav.name);

    return (
        <Tooltip text={fav.name} position="bottom">
            {(tooltipProps: any) => (
                <div
                    {...tooltipProps}
                    className={`${cl("pinnedFav")} ${isSelected ? cl("pinnedFavSelected") : ""}`}
                    onClick={handleClick}
                    onContextMenu={(e: React.MouseEvent) => onContextMenu(e, index)}
                >
                    {iconUrl
                        ? <img className={cl("pinnedFavIcon")} src={iconUrl} alt="" />
                        : <div className={cl("pinnedFavIconText")}>{fallback}</div>
                    }
                    <div className={cl("pinnedFavPin")}>
                        <PinIcon />
                    </div>
                </div>
            )}
        </Tooltip>
    );
}

// =================== Main TopBar Component ===================

export function ChannelTabsBar() {
    const {
        tabs, showTabBar, showFavBar, compactStyle, wrapTabs, favs,
        openNewTab, updateCurrentTab, closeTab, addToFavs, removeFav,
    } = useTabStore();
    const containerRef = useRef<HTMLDivElement>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, items: [] });

    // Track channel navigation and update the current tab
    useEffect(() => {
        const handler = () => {
            setTimeout(() => {
                updateCurrentTab();
            }, 100);
        };

        window.addEventListener("popstate", handler);

        let lastPath = location.pathname;
        const interval = setInterval(() => {
            if (location.pathname !== lastPath) {
                lastPath = location.pathname;
                handler();
            }
        }, 200);

        return () => {
            window.removeEventListener("popstate", handler);
            clearInterval(interval);
        };
    }, []);

    const handleTabContextMenu = (e: React.MouseEvent, index: number) => {
        e.preventDefault();
        e.stopPropagation();
        const tab = tabs[index];
        const isAlreadyFav = favs.some(f => f.url === tab.url);
        const items: ContextMenuItem[] = [
            {
                label: "Close Tab",
                action: () => closeTab(index),
                disabled: tabs.length <= 1,
            },
            {
                label: "Close Other Tabs",
                action: () => {
                    // Close all tabs except this one (iterate from end to avoid index shift)
                    for (let i = tabs.length - 1; i >= 0; i--) {
                        if (i !== index && tabs.length > 1) closeTab(i);
                    }
                },
                disabled: tabs.length <= 1,
            },
            {
                label: "Close Tabs to the Right",
                action: () => {
                    for (let i = tabs.length - 1; i > index; i--) {
                        closeTab(i);
                    }
                },
                disabled: index >= tabs.length - 1,
            },
        ];
        if (!isAlreadyFav) {
            items.push({
                label: "Save as Favourite",
                action: () => {
                    addToFavs(tab.name, tab.url, tab.channelId);
                },
            });
        }
        setContextMenu({ visible: true, x: e.clientX, y: e.clientY, items });
    };

    const handleFavContextMenu = (e: React.MouseEvent, index: number) => {
        e.preventDefault();
        e.stopPropagation();
        const items: ContextMenuItem[] = [
            {
                label: "Remove Favourite",
                action: () => removeFav(index),
                danger: true,
            },
        ];
        setContextMenu({ visible: true, x: e.clientX, y: e.clientY, items });
    };

    const closeContextMenu = () => setContextMenu(prev => ({ ...prev, visible: false }));

    if (!showTabBar && !showFavBar) return null;

    const containerClass = [
        cl("container"),
        compactStyle && cl("compact"),
    ].filter(Boolean).join(" ");

    const hasPinnedFavs = showFavBar && favs.length > 0;

    return (
        <div ref={containerRef} className={containerClass}>
            <div className={`${cl("tabContainer")} ${wrapTabs ? cl("wrap") : ""}`}>
                {/* Pinned favourites first */}
                {hasPinnedFavs && favs.map((fav, i) => (
                    <PinnedFav key={`fav-${fav.url}-${i}`} fav={fav} index={i} onContextMenu={handleFavContextMenu} />
                ))}
                {/* Divider between pinned and tabs */}
                {hasPinnedFavs && showTabBar && (
                    <div className={cl("pinnedDivider")} />
                )}
                {/* Regular tabs */}
                {showTabBar && tabs.map((tab, i) => (
                    <Tab key={`${tab.url}-${i}`} tab={tab} index={i} onContextMenu={handleTabContextMenu} />
                ))}
                {showTabBar && (
                    <div className={cl("newTab")} onClick={() => openNewTab()}>
                        <PlusIcon />
                    </div>
                )}
            </div>
            <NativeContextMenu state={contextMenu} onClose={closeContextMenu} />
        </div>
    );
}
