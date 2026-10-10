/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { Flex } from "@components/Flex";
import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { classNameFactory } from "@utils/css";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { moment, TextArea, TextInput, useState } from "@webpack/common";

const cl = classNameFactory("vc-textExpander-");
const logger = new Logger("TextExpander");

const CURSOR_TAG = "%cursor%";
const CLIP_TAG = "%clip%";
const DATE_TAG = /%d\(([^)]*)\)/g;

interface Shortcut {
    shortcut: string;
    expansion: string;
    id: string;
}

const makeEmptyShortcut = (): Shortcut => ({
    shortcut: "",
    expansion: "",
    id: crypto.randomUUID()
});

const settings = definePluginSettings({
    editor: {
        type: OptionType.COMPONENT,
        component: ShortcutEditor
    },
    shortcuts: {
        type: OptionType.CUSTOM,
        default: [makeEmptyShortcut()] as Shortcut[],
        description: "Shortcuts and the text they expand to."
    },
    requireWordBoundary: {
        type: OptionType.BOOLEAN,
        description: "Only expand shortcuts typed at the start of a line or after whitespace",
        default: true
    },
    caseSensitive: {
        type: OptionType.BOOLEAN,
        description: "Match shortcuts case sensitively",
        default: true
    }
});

function Input({ initialValue, onChange, placeholder, multiline }: {
    placeholder: string;
    initialValue: string;
    multiline?: boolean;
    onChange(value: string): void;
}) {
    const [value, setValue] = useState(initialValue);
    const Component = multiline ? TextArea : TextInput;

    return (
        <Component
            placeholder={placeholder}
            value={value}
            onChange={setValue}
            spellCheck={false}
            autosize={multiline}
            onBlur={() => value !== initialValue && setTimeout(() => onChange(value), 0)}
        />
    );
}

function ShortcutEditor() {
    const { shortcuts } = settings.use(["shortcuts"]);

    return (
        <>
            <div>
                <HeadingSecondary>Shortcuts</HeadingSecondary>
                <Paragraph>
                    Type a shortcut in any chat box and it is replaced with its expansion right away.
                    Expansions may contain <code>{CLIP_TAG}</code> (clipboard contents), <code>%d(format)</code> (current
                    date using a moment.js format, e.g. <code>%d(YYYY-MM-DD HH:mm)</code>) and <code>{CURSOR_TAG}</code> (where
                    the cursor ends up).
                </Paragraph>
            </div>
            <Flex flexDirection="column" style={{ gap: "0.5em", paddingBottom: "1.25em" }}>
                {shortcuts.map((entry, index) =>
                    <div key={entry.id} className={cl("row")}>
                        <Input
                            placeholder="Shortcut, e.g. brb"
                            initialValue={entry.shortcut}
                            onChange={v => shortcuts[index].shortcut = v}
                        />
                        <Input
                            placeholder="Expansion, e.g. be right back"
                            initialValue={entry.expansion}
                            onChange={v => shortcuts[index].expansion = v}
                            multiline
                        />
                        <Button
                            variant="dangerPrimary"
                            onClick={() => shortcuts.splice(index, 1)}
                        >
                            Delete
                        </Button>
                    </div>
                )}
                <Button
                    onClick={() => shortcuts.push(makeEmptyShortcut())}
                    disabled={shortcuts.length > 0 && !shortcuts[shortcuts.length - 1].shortcut}
                >
                    Add Shortcut
                </Button>
            </Flex>
        </>
    );
}

interface Caret {
    editor: HTMLElement;
    textBefore: string;
}

function getCaret(): Caret | null {
    const selection = window.getSelection();
    if (!selection?.isCollapsed) return null;

    const { anchorNode, anchorOffset } = selection;
    if (anchorNode?.nodeType !== Node.TEXT_NODE) return null;

    const editor = anchorNode.parentElement?.closest<HTMLElement>("[data-slate-editor=true]");
    if (!editor) return null;

    return { editor, textBefore: anchorNode.textContent!.slice(0, anchorOffset) };
}

function findShortcut(textBefore: string) {
    const { requireWordBoundary, caseSensitive, shortcuts } = settings.store;
    const haystack = caseSensitive ? textBefore : textBefore.toLowerCase();

    let best: Shortcut | null = null;
    for (const entry of shortcuts) {
        if (!entry.shortcut || !entry.expansion) continue;
        if (best && entry.shortcut.length <= best.shortcut.length) continue;

        const needle = caseSensitive ? entry.shortcut : entry.shortcut.toLowerCase();
        if (!haystack.endsWith(needle)) continue;

        const charBefore = haystack[haystack.length - needle.length - 1];
        // \s also covers the zero width placeholder slate puts in empty text nodes
        if (requireWordBoundary && charBefore !== undefined && !/\s/.test(charBefore)) continue;

        best = entry;
    }

    return best;
}

// Whether typing more could still turn text into a (longer) shortcut, e.g. "u" when "ur" also exists
function isShortcutPrefix(text: string) {
    const { caseSensitive, shortcuts } = settings.store;
    const prefix = caseSensitive ? text : text.toLowerCase();

    return shortcuts.some(({ shortcut, expansion }) =>
        expansion && shortcut.length > prefix.length && (caseSensitive ? shortcut : shortcut.toLowerCase()).startsWith(prefix)
    );
}

interface Match {
    entry: Shortcut;
    /** Character typed after the shortcut which has to be kept */
    suffix: string;
}

function findMatch(textBefore: string): Match | null {
    const direct = findShortcut(textBefore);
    if (direct)
        return isShortcutPrefix(direct.shortcut) ? null : { entry: direct, suffix: "" };

    // A shortcut that was held back because it could have become a longer one, but the next character ruled that out
    const suffix = textBefore.slice(-1);
    const deferred = suffix && findShortcut(textBefore.slice(0, -1));
    if (deferred && !isShortcutPrefix(deferred.shortcut + suffix))
        return { entry: deferred, suffix };

    return null;
}

async function resolveExpansion(expansion: string) {
    let text = expansion.replace(DATE_TAG, (_, format) => moment().format(format || "L"));

    if (text.includes(CLIP_TAG)) {
        const clipboard = await navigator.clipboard.readText().catch(e => {
            logger.error("Failed to read clipboard", e);
            return "";
        });
        text = text.replaceAll(CLIP_TAG, () => clipboard);
    }

    return text.replace(/\r\n?/g, "\n");
}

// Slate listens for native beforeinput events, so this edits the editor the same way typing would
function sendInput(editor: HTMLElement, inputType: string, data?: string) {
    editor.dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true }));
}

function insertText(editor: HTMLElement, text: string) {
    text.split("\n").forEach((line, i) => {
        if (i > 0) sendInput(editor, "insertLineBreak");
        if (line) sendInput(editor, "insertText", line);
    });
}

async function tryExpand() {
    const caret = getCaret();
    const match = caret && findMatch(caret.textBefore);
    if (!match) return;

    const { entry, suffix } = match;
    const text = await resolveExpansion(entry.expansion) + suffix;

    // Reading the clipboard is async, so make sure nothing changed in the meantime
    const { editor } = caret;
    const current = findMatch(getCaret()?.textBefore ?? "");
    // Settings objects are fresh proxies on every access, so compare ids rather than identity
    if (!editor.isConnected || current?.entry.id !== entry.id || current.suffix !== suffix) return;

    for (let i = Array.from(entry.shortcut + suffix).length; i > 0; i--)
        sendInput(editor, "deleteContentBackward");

    const cursorIndex = text.indexOf(CURSOR_TAG);
    if (cursorIndex === -1) {
        insertText(editor, text);
        return;
    }

    const after = text.slice(cursorIndex + CURSOR_TAG.length).replaceAll(CURSOR_TAG, "");
    insertText(editor, text.slice(0, cursorIndex) + after);

    // Wait for slate to render the inserted text before moving the caret back over it
    requestAnimationFrame(() => {
        const selection = window.getSelection();
        for (let i = Array.from(after).length; i > 0; i--)
            selection?.modify("move", "backward", "character");
    });
}

function onBeforeInput(e: InputEvent) {
    // Our own events are untrusted, which also keeps expansions from triggering each other
    if (!e.isTrusted || e.isComposing || e.inputType !== "insertText") return;
    if (!(e.target as HTMLElement | null)?.closest?.("[data-slate-editor=true]")) return;

    // Run once slate has applied the keystroke
    setTimeout(() => tryExpand().catch(err => logger.error("Failed to expand shortcut", err)), 0);
}

export default definePlugin({
    name: "TextExpander",
    description: "Expands custom shortcuts into longer text as you type",
    tags: ["Chat", "Utility"],
    authors: [{ name: "Saturn", id: 965286897662443570n }],

    settings,

    start() {
        settings.store.shortcuts.forEach(entry => entry.id ??= crypto.randomUUID());
        document.addEventListener("beforeinput", onBeforeInput, true);
    },

    stop() {
        document.removeEventListener("beforeinput", onBeforeInput, true);
    },

    // A held back shortcut at the very end of the message never sees a following character, so expand it on send
    async onBeforeMessageSend(_, msg) {
        const entry = findShortcut(msg.content);
        if (!entry) return;

        const expansion = (await resolveExpansion(entry.expansion)).replaceAll(CURSOR_TAG, "");
        msg.content = msg.content.slice(0, -entry.shortcut.length) + expansion;
    }
});
