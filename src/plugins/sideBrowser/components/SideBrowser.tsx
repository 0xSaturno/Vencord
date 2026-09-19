/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "@plugins/sideBrowser/settings";
import { Logger } from "@utils/Logger";
import { useEffect, useRef, useState } from "@webpack/common";
import React from "react";

interface Bookmark {
    name: string;
    url: string;
}

const DEFAULT_BOOKMARKS: Bookmark[] = [
    { name: "DuckDuckGo", url: "https://duckduckgo.com" },
    { name: "YouTube", url: "https://youtube.com" },
    { name: "Reddit", url: "https://reddit.com" },
];

const STORAGE_KEY_BOOKMARKS = "vc-sidebrowser-bookmarks";

// Global state bridge for toggling the browser externally (e.g. from keybinds or toolbox)
type StateListener = (isOpen: boolean) => void;
const listeners = new Set<StateListener>();
let globalIsOpen = false;

export function toggleSideBrowser() {
    globalIsOpen = !globalIsOpen;
    listeners.forEach(cb => cb(globalIsOpen));
}

export function openSideBrowser(targetUrl?: string) {
    globalIsOpen = true;
    listeners.forEach(cb => cb(globalIsOpen));
    if (targetUrl && globalNavigate) {
        globalNavigate(targetUrl);
    }
}

let globalNavigate: ((url: string) => void) | null = null;

const logger = new Logger("SideBrowser");

// Own persistent session: keeps site cookies apart from Discord's and out of Vencord's CSP header hooks
const WEBVIEW_PARTITION = "persist:vc-sidebrowser";
// Plain Chrome UA; some sites (e.g. Google sign-in) refuse embedded Electron/Discord clients
const DESKTOP_USER_AGENT = navigator.userAgent.replace(/\s(discord|Electron)\/\S+/gi, "");
// Most sites pick their mobile layout from the UA, not the viewport width
const CHROME_VERSION = navigator.userAgent.match(/Chrome\/(\S+)/)?.[1] ?? "148.0.0.0";
const MOBILE_USER_AGENT = `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Mobile Safari/537.36`;

const isMobileWidth = (width: number) => width < settings.store.mobileWidth;

// Electron can only mute a webview, not change its volume. This runs inside the page and scales every
// <video>/<audio> by the browser volume, while the page keeps seeing (and setting) its own volume.
// Kept as a string so the bundler can't inject helpers that don't exist in the page.
const makeVolumeScript = (volume: number) => `(() => {
    const w = window;
    w.__vcSbVolume = ${volume};
    if (!w.__vcSbApply) {
        const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
        const apply = el => desc.set.call(el, (el.__vcSbWanted ?? 1) * w.__vcSbVolume);
        Object.defineProperty(HTMLMediaElement.prototype, "volume", {
            configurable: true,
            get() { return this.__vcSbWanted ?? desc.get.call(this); },
            set(value) { this.__vcSbWanted = Math.min(Math.max(Number(value) || 0, 0), 1); apply(this); }
        });
        const { play } = HTMLMediaElement.prototype;
        HTMLMediaElement.prototype.play = function () { apply(this); return play.apply(this, arguments); };
        document.addEventListener("play", e => { if (e.target instanceof HTMLMediaElement) apply(e.target); }, true);
        w.__vcSbApply = apply;
    }
    document.querySelectorAll("video, audio").forEach(w.__vcSbApply);
})()`;

function formatInputUrl(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return settings.store.homeUrl;

    if (/^(https?|data|about|blob):/i.test(trimmed)) {
        return trimmed;
    }

    // IP address or localhost
    if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(trimmed)) {
        return `http://${trimmed}`;
    }

    // Typical domain name: example.com, sub.example.org, etc.
    if (/^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(trimmed)) {
        return `https://${trimmed}`;
    }

    // Treat as search query
    return `${settings.store.searchEngine}${encodeURIComponent(trimmed)}`;
}

export function SideBrowser() {
    const [isOpen, setIsOpen] = useState(globalIsOpen);
    // Whether the <webview> exists. Removing it from the DOM destroys the guest process, so the page
    // only costs resources after the browser was opened and until it's closed with the X button
    const [isAlive, setIsAlive] = useState(globalIsOpen);
    const [currentUrl, setCurrentUrl] = useState(settings.store.homeUrl);
    const [omnibarValue, setOmnibarValue] = useState(settings.store.homeUrl);
    const [pageTitle, setPageTitle] = useState("Side Browser");
    const [isLoading, setIsLoading] = useState(false);
    const [canGoBack, setCanGoBack] = useState(false);
    const [canGoForward, setCanGoForward] = useState(false);
    const [panelWidth, setPanelWidth] = useState(settings.store.defaultWidth || 480);
    const [isResizing, setIsResizing] = useState(false);
    // Only re-evaluated when a drag ends, so resizing doesn't reload the page on every pixel
    const [isMobile, setIsMobile] = useState(() => isMobileWidth(panelWidth));

    const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_BOOKMARKS);
            return raw ? JSON.parse(raw) : DEFAULT_BOOKMARKS;
        } catch {
            return DEFAULT_BOOKMARKS;
        }
    });

    const [titleBarHeight, setTitleBarHeight] = useState(0);
    const webviewRef = useRef<any>(null);
    const isDomReadyRef = useRef(false);
    const isFocusedRef = useRef(false);

    const [volume, setVolume] = useState(settings.store.volume);
    const [showVolume, setShowVolume] = useState(false);
    const volumeRef = useRef(volume);
    const lastAudibleVolumeRef = useRef(volume || 100);

    // Only touches refs, so it's safe to call from listeners registered on first render
    const applyVolume = () => {
        const wv = webviewRef.current;
        if (!wv || !isDomReadyRef.current) return;

        const level = volumeRef.current / 100;
        try {
            // Muting also covers Web Audio and media inside iframes, which the script can't reach
            wv.setAudioMuted(level === 0);
            wv.executeJavaScript(makeVolumeScript(level)).catch(() => { });
        } catch (err: any) {
            logger.warn(`Volume apply failed: ${err?.message || err}`);
        }
    };

    const changeVolume = (value: number) => {
        setVolume(value);
        volumeRef.current = value;
        if (value > 0) lastAudibleVolumeRef.current = value;
        settings.store.volume = value;
        applyVolume();
    };

    // Register external open/close listener
    useEffect(() => {
        const handler: StateListener = val => setIsOpen(val);
        listeners.add(handler);
        return () => {
            listeners.delete(handler);
        };
    }, []);

    // Detect Discord's titlebar height to prevent covering titlebar buttons
    useEffect(() => {
        const checkTitleBar = () => {
            const tb = document.querySelector<HTMLElement>("[class*='titleBar'], [class*='typeWindows']");
            if (tb && getComputedStyle(tb).display !== "none") {
                setTitleBarHeight(tb.offsetHeight);
            } else {
                setTitleBarHeight(0);
            }
        };
        checkTitleBar();
        window.addEventListener("resize", checkTitleBar);
        return () => window.removeEventListener("resize", checkTitleBar);
    }, []);

    const navigateTo = (target: string) => {
        const formatted = formatInputUrl(target);
        setCurrentUrl(formatted);
        setOmnibarValue(formatted);
        setIsLoading(true);

        const wv = webviewRef.current;
        if (!wv) return;
        try {
            wv.setAttribute("src", formatted);
            wv.src = formatted;
        } catch (err: any) {
            logger.error(`Webview src assignment error: ${err?.message || err}`);
        }
    };

    useEffect(() => {
        globalNavigate = navigateTo;
        return () => {
            globalNavigate = null;
        };
    }, []);

    useEffect(() => {
        if (isOpen) setIsAlive(true);
    }, [isOpen]);

    const closeAndKill = () => {
        if (globalIsOpen) toggleSideBrowser();
        setIsAlive(false);
        isDomReadyRef.current = false;
        setIsLoading(false);
        setCanGoBack(false);
        setCanGoForward(false);
    };

    // Attach webview event listeners (again whenever a fresh webview is created)
    useEffect(() => {
        const wv = webviewRef.current;
        if (!wv) return;

        isDomReadyRef.current = false;

        const onDomReady = () => {
            isDomReadyRef.current = true;
            applyVolume();
            setIsLoading(false);
            try {
                if (typeof wv.canGoBack === "function") setCanGoBack(wv.canGoBack());
                if (typeof wv.canGoForward === "function") setCanGoForward(wv.canGoForward());
                if (typeof wv.getURL === "function") {
                    const url = wv.getURL();
                    if (url && url !== "about:blank") {
                        setCurrentUrl(url);
                        if (!isFocusedRef.current) setOmnibarValue(url);
                    }
                }
                if (typeof wv.getTitle === "function") {
                    const t = wv.getTitle();
                    if (t) setPageTitle(t);
                }
            } catch (err: any) {
                logger.warn(`dom-ready read failed: ${err?.message || err}`);
            }
        };

        const onStartLoading = () => {
            setIsLoading(true);
        };

        const onStopLoading = () => {
            setIsLoading(false);
            if (!isDomReadyRef.current) return;
            try {
                if (typeof wv.canGoBack === "function") setCanGoBack(wv.canGoBack());
                if (typeof wv.canGoForward === "function") setCanGoForward(wv.canGoForward());
                if (typeof wv.getURL === "function") {
                    const url = wv.getURL();
                    if (url && url !== "about:blank") {
                        setCurrentUrl(url);
                        if (!isFocusedRef.current) setOmnibarValue(url);
                    }
                }
                if (typeof wv.getTitle === "function") {
                    const t = wv.getTitle();
                    if (t) setPageTitle(t);
                }
            } catch { }
        };

        const onFailLoad = (e: any) => {
            setIsLoading(false);
            // -3 (ERR_ABORTED) fires for ordinary cancelled/replaced navigations
            if (e?.errorCode === -3) return;
            logger.warn(`Webview 'did-fail-load': ${e?.errorDescription || "Unknown error"} (Code: ${e?.errorCode})`);
        };

        const onNavigate = (e: any) => {
            if (e.url) {
                setCurrentUrl(e.url);
                if (!isFocusedRef.current) setOmnibarValue(e.url);
            }
            if (isDomReadyRef.current) {
                try {
                    if (typeof wv.canGoBack === "function") setCanGoBack(wv.canGoBack());
                    if (typeof wv.canGoForward === "function") setCanGoForward(wv.canGoForward());
                } catch { }
            }
        };

        const onTitleUpdated = (e: any) => {
            if (e.title) setPageTitle(e.title);
        };


        wv.addEventListener("dom-ready", onDomReady);
        wv.addEventListener("did-start-loading", onStartLoading);
        wv.addEventListener("did-stop-loading", onStopLoading);
        wv.addEventListener("did-fail-load", onFailLoad);
        wv.addEventListener("did-navigate", onNavigate);
        wv.addEventListener("did-navigate-in-page", onNavigate);
        wv.addEventListener("page-title-updated", onTitleUpdated);

        return () => {
            wv.removeEventListener("dom-ready", onDomReady);
            wv.removeEventListener("did-start-loading", onStartLoading);
            wv.removeEventListener("did-stop-loading", onStopLoading);
            wv.removeEventListener("did-fail-load", onFailLoad);
            wv.removeEventListener("did-navigate", onNavigate);
            wv.removeEventListener("did-navigate-in-page", onNavigate);
            wv.removeEventListener("page-title-updated", onTitleUpdated);
        };
    }, [isAlive]);

    // Switch between desktop and mobile sites when crossing the width threshold
    const isFirstMobileRun = useRef(true);
    useEffect(() => {
        if (isFirstMobileRun.current) {
            isFirstMobileRun.current = false;
            return;
        }

        const wv = webviewRef.current;
        if (!wv || !isDomReadyRef.current) return;

        try {
            wv.setUserAgent(isMobile ? MOBILE_USER_AGENT : DESKTOP_USER_AGENT);
            wv.reload();
        } catch (err: any) {
            logger.error(`User agent switch error: ${err?.message || err}`);
        }
    }, [isMobile]);

    // Drag-to-resize handle
    const handleMouseDownResize = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        const startX = e.clientX;
        const startWidth = panelWidth;
        let newWidth = startWidth;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = startX - moveEvent.clientX;
            const maxWidth = Math.min(window.innerWidth * 0.85, 1400);
            newWidth = Math.min(Math.max(320, startWidth + delta), maxWidth);
            setPanelWidth(newWidth);
        };

        const onMouseUp = () => {
            setIsResizing(false);
            setIsMobile(isMobileWidth(newWidth));
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    };

    const handleBack = () => {
        const wv = webviewRef.current;
        if (!wv || !isDomReadyRef.current) return;
        try {
            if (wv.canGoBack?.()) wv.goBack();
        } catch { }
    };

    const handleForward = () => {
        const wv = webviewRef.current;
        if (!wv || !isDomReadyRef.current) return;
        try {
            if (wv.canGoForward?.()) wv.goForward();
        } catch { }
    };

    const handleReload = () => {
        setIsLoading(true);
        const wv = webviewRef.current;
        if (!wv) return;
        if (isLoading) {
            try { wv.stop?.(); } catch { }
            setIsLoading(false);
        } else {
            try {
                wv.setAttribute("src", currentUrl);
                wv.src = currentUrl;
            } catch { }
        }
    };

    const handleHome = () => {
        navigateTo(settings.store.homeUrl);
    };

    const handleOpenExternal = () => {
        if (currentUrl && (window as any).VencordNative?.native?.openExternal) {
            (window as any).VencordNative.native.openExternal(currentUrl);
        } else if (currentUrl) {
            window.open(currentUrl, "_blank");
        }
    };

    const handleCopyUrl = () => {
        if (currentUrl) {
            navigator.clipboard.writeText(currentUrl);
        }
    };

    const handleOmnibarKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.currentTarget.blur();
            navigateTo(omnibarValue);
        }
    };

    const addBookmark = () => {
        try {
            const name = prompt("Bookmark Name:", pageTitle || "New Bookmark");
            if (!name) return;
            const updated = [...bookmarks, { name, url: currentUrl }];
            setBookmarks(updated);
            localStorage.setItem(STORAGE_KEY_BOOKMARKS, JSON.stringify(updated));
        } catch { }
    };

    const removeBookmark = (index: number) => {
        if (confirm(`Remove bookmark "${bookmarks[index].name}"?`)) {
            const updated = bookmarks.filter((_, i) => i !== index);
            setBookmarks(updated);
            localStorage.setItem(STORAGE_KEY_BOOKMARKS, JSON.stringify(updated));
        }
    };

    const { showEdgeTab, showBookmarks } = settings.store;

    return (
        <>
            {/* Subtle floating toggle tab on the right edge */}
            {showEdgeTab && (
                <div
                    className={`vc-sidebrowser-edge-tab ${isOpen ? "vc-tab-open" : ""} ${isResizing ? "vc-resizing" : ""}`}
                    style={isOpen ? { right: `${panelWidth}px` } : undefined}
                    onClick={e => {
                        e.stopPropagation();
                        toggleSideBrowser();
                    }}
                    title={isOpen ? "Collapse Side Browser" : "Open Side Browser (Ctrl+Shift+B)"}
                >
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                    </svg>
                </div>
            )}

            {/* Sliding Drawer */}
            <aside
                className={`vc-sidebrowser-drawer ${isOpen ? "vc-open" : ""} ${isResizing ? "vc-resizing" : ""}`}
                style={{
                    width: `${panelWidth}px`,
                    top: `${titleBarHeight}px`,
                }}
            >
                {/* Drag resizer handle on the left border */}
                <div
                    className="vc-sidebrowser-resizer"
                    onMouseDown={handleMouseDownResize}
                    title="Drag to resize panel"
                />

                {/* Mouse-intercept overlay during resize */}
                {isResizing && <div className="vc-sidebrowser-drag-overlay" />}

                {/* Header / Navigation Controls */}
                <header className="vc-sidebrowser-header">
                    <div className="vc-sidebrowser-nav-row">
                        {/* Back */}
                        <button
                            type="button"
                            className="vc-sidebrowser-btn"
                            disabled={!canGoBack || !isDomReadyRef.current}
                            onClick={handleBack}
                            title="Back"
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z" />
                            </svg>
                        </button>

                        {/* Forward */}
                        <button
                            type="button"
                            className="vc-sidebrowser-btn"
                            disabled={!canGoForward || !isDomReadyRef.current}
                            onClick={handleForward}
                            title="Forward"
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
                            </svg>
                        </button>

                        {/* Reload / Stop */}
                        <button
                            type="button"
                            className="vc-sidebrowser-btn"
                            onClick={handleReload}
                            title={isLoading ? "Stop" : "Reload"}
                        >
                            {isLoading ? (
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                </svg>
                            ) : (
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                                </svg>
                            )}
                        </button>

                        {/* Home */}
                        <button
                            type="button"
                            className="vc-sidebrowser-btn"
                            onClick={handleHome}
                            title="Home"
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                            </svg>
                        </button>

                        {/* Omnibar Input */}
                        <div
                            className="vc-sidebrowser-omnibar-wrapper"
                            onClick={e => e.stopPropagation()}
                        >
                            <span className="vc-sidebrowser-omnibar-icon">
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                                </svg>
                            </span>
                            <input
                                type="text"
                                className="vc-sidebrowser-omnibar"
                                value={omnibarValue}
                                onChange={e => setOmnibarValue(e.target.value)}
                                onKeyDown={handleOmnibarKeyDown}
                                onClick={e => e.stopPropagation()}
                                onFocus={e => {
                                    isFocusedRef.current = true;
                                    e.target.select();
                                }}
                                onBlur={() => {
                                    isFocusedRef.current = false;
                                    setOmnibarValue(currentUrl);
                                }}
                                placeholder="Search web or enter URL..."
                            />
                        </div>

                        {/* Volume: hover for the slider, click to mute / unmute */}
                        <div
                            className="vc-sidebrowser-volume"
                            onMouseEnter={() => setShowVolume(true)}
                            onMouseLeave={() => setShowVolume(false)}
                        >
                            <button
                                type="button"
                                className="vc-sidebrowser-btn"
                                onClick={e => {
                                    e.stopPropagation();
                                    changeVolume(volume === 0 ? lastAudibleVolumeRef.current : 0);
                                }}
                                title={volume === 0 ? "Unmute" : "Mute"}
                            >
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d={volume === 0 ? "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" : "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"} />
                                </svg>
                            </button>
                            {showVolume && (
                                <div className="vc-sidebrowser-volume-popover" onClick={e => e.stopPropagation()}>
                                    <input
                                        type="range"
                                        className="vc-sidebrowser-volume-slider"
                                        min={0}
                                        max={100}
                                        value={volume}
                                        onChange={e => changeVolume(Number(e.currentTarget.value))}
                                        aria-label="Browser volume"
                                    />
                                    <span className="vc-sidebrowser-volume-label">{volume}%</span>
                                </div>
                            )}
                        </div>

                        {/* Copy Link */}
                        <button
                            type="button"
                            className="vc-sidebrowser-btn"
                            onClick={handleCopyUrl}
                            title="Copy URL"
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                            </svg>
                        </button>

                        {/* Open in Default Browser */}
                        <button
                            type="button"
                            className="vc-sidebrowser-btn"
                            onClick={handleOpenExternal}
                            title="Open in default browser"
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                            </svg>
                        </button>

                        {/* Close / Collapse */}
                        <button
                            type="button"
                            className="vc-sidebrowser-btn vc-btn-danger"
                            onClick={e => {
                                e.stopPropagation();
                                closeAndKill();
                            }}
                            title="Close Side Browser (ends the page; Ctrl+Shift+B only hides it)"
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                            </svg>
                        </button>
                    </div>

                    {/* Quick Bookmarks Toolbar */}
                    {showBookmarks && (
                        <div className="vc-sidebrowser-bookmarks">
                            {bookmarks.map((bm, idx) => (
                                <button
                                    key={`${bm.url}-${idx}`}
                                    type="button"
                                    className="vc-sidebrowser-bookmark-chip"
                                    onClick={e => {
                                        e.stopPropagation();
                                        navigateTo(bm.url);
                                    }}
                                    onContextMenu={e => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        removeBookmark(idx);
                                    }}
                                    title={`${bm.name} (${bm.url})\nRight click to remove`}
                                >
                                    {bm.name}
                                </button>
                            ))}
                            <button
                                type="button"
                                className="vc-sidebrowser-bookmark-chip vc-sidebrowser-bookmark-add"
                                onClick={e => {
                                    e.stopPropagation();
                                    addBookmark();
                                }}
                                title="Bookmark current page"
                            >
                                + Add
                            </button>
                        </div>
                    )}
                </header>

                {/* Progress bar */}
                <div className={`vc-sidebrowser-progress-bar ${isLoading ? "vc-loading" : ""}`} />

                {/* Web Viewport */}
                <div className="vc-sidebrowser-viewport">
                    {isAlive && <webview
                        ref={webviewRef}
                        src={currentUrl}
                        // React drops boolean values for unknown attributes, so pass it as a string
                        {...{ allowpopups: "true" } as {}}
                        // eslint-disable-next-line react/no-unknown-property
                        partition={WEBVIEW_PARTITION}
                        // eslint-disable-next-line react/no-unknown-property
                        useragent={isMobile ? MOBILE_USER_AGENT : DESKTOP_USER_AGENT}
                        className="vc-sidebrowser-webview"
                    />}
                </div>
            </aside>
        </>
    );
}
