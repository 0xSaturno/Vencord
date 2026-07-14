import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import managedStyle from "./styles.css?managed";

export const settings = definePluginSettings({
    hoverDelay: {
        type: OptionType.SLIDER,
        description: "Delay before showing image (ms)",
        markers: [0, 100, 300, 500, 1000],
        default: 300,
        stickToMarkers: false,
    },
});

let hoverTimeout: NodeJS.Timeout | null = null;
let currentImageSrc: string | null = null;
let overlayContainer: HTMLDivElement | null = null;
let overlayImage: HTMLImageElement | null = null;
let loadingIndicator: HTMLDivElement | null = null;
let isHovering = false;
let lastX = 0;
let lastY = 0;

function getHighResUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        // If it's a discord media proxy, strip width and height
        if (urlObj.hostname === 'media.discordapp.net') {
            urlObj.searchParams.delete('width');
            urlObj.searchParams.delete('height');
        } else if (urlObj.hostname === 'cdn.discordapp.com') {
            // High res for avatars and icons
            urlObj.searchParams.set('size', '4096');
        }
        return urlObj.toString();
    } catch {
        return url;
    }
}

function extractImageSrc(target: HTMLElement): string | null {
    if (target.tagName === 'IMG') {
        return (target as HTMLImageElement).src;
    }
    
    // Check background image for avatars/icons
    const bgImg = window.getComputedStyle(target).backgroundImage;
    if (bgImg && bgImg !== 'none' && bgImg.includes('url(')) {
        const match = bgImg.match(/url\(['"]?(.*?)['"]?\)/);
        if (match) return match[1];
    }
    
    // Check if wrapped in an anchor
    const anchor = target.closest('a');
    if (anchor) {
        const img = anchor.querySelector('img');
        if (img) return img.src;
        
        const href = anchor.href;
        if (href && (href.match(/\.(png|jpg|jpeg|webp|gif)$/i) || href.includes('media.discordapp.net'))) {
            return href;
        }
    }
    
    // Check if target is a relatively small wrapper containing an image (e.g. Discord chat image wrappers)
    const img = target.querySelector('img');
    if (img) {
        const rect = target.getBoundingClientRect();
        if (rect.width < 600 && rect.height < 600) {
            return img.src;
        }
    }
    
    // Check parent/siblings if we hovered an overlay (like spoiler or play button)
    const parent = target.parentElement;
    if (parent) {
        const rect = parent.getBoundingClientRect();
        if (rect.width < 600 && rect.height < 600) {
            const siblingImg = parent.querySelector('img');
            if (siblingImg) return siblingImg.src;
        }
    }

    return null;
}

function createOverlay() {
    if (!overlayContainer) {
        overlayContainer = document.createElement("div");
        overlayContainer.id = "vc-imagus-overlay";
        
        overlayImage = document.createElement("img");
        overlayContainer.appendChild(overlayImage);
        
        document.body.appendChild(overlayContainer);
    }
    if (!loadingIndicator) {
        loadingIndicator = document.createElement("div");
        loadingIndicator.id = "vc-imagus-loader";
        document.body.appendChild(loadingIndicator);
    }
}

function removeOverlay() {
    if (overlayContainer) {
        overlayContainer.style.display = 'none';
        if (overlayImage) overlayImage.src = '';
    }
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }
}

function updateOverlayPosition(x: number, y: number) {
    if (loadingIndicator && loadingIndicator.style.display === 'block') {
        loadingIndicator.style.left = `${x + 15}px`;
        loadingIndicator.style.top = `${y + 15}px`;
    }

    if (!overlayContainer || !overlayImage || overlayContainer.style.display === 'none') return;

    const offset = 15;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // We use offsetWidth/Height which gives the current rendered size of the element
    const imgWidth = overlayImage.offsetWidth;
    const imgHeight = overlayImage.offsetHeight;
    
    // If the image hasn't loaded yet, dimensions might be 0. We'll update again on mousemove.
    if (imgWidth === 0 || imgHeight === 0) return;

    let left = x + offset;
    let top = y + offset;
    
    // If it goes off the right edge, flip it to the left of the cursor
    if (left + imgWidth > viewportWidth) {
        left = x - offset - imgWidth;
    }
    // Failsafe if it's too wide for the screen
    if (left < 0) left = 0;

    // If it goes off the bottom edge, flip it above the cursor
    if (top + imgHeight > viewportHeight) {
        top = y - offset - imgHeight;
    }
    // Failsafe if it's too tall
    if (top < 0) top = 0;
    
    overlayContainer.style.left = `${left}px`;
    overlayContainer.style.top = `${top}px`;
}

function handleMouseOver(e: MouseEvent) {
    const target = e.target as HTMLElement;
    lastX = e.clientX;
    lastY = e.clientY;
    
    const imgSrc = extractImageSrc(target);
    if (!imgSrc) return;

    // Filter out standard emojis and assets to avoid triggering on UI elements
    if (target.classList.contains("emoji") || imgSrc.includes("/assets/")) return;

    isHovering = true;
    currentImageSrc = getHighResUrl(imgSrc);

    if (hoverTimeout) clearTimeout(hoverTimeout);
    
    hoverTimeout = setTimeout(() => {
        if (!isHovering || !currentImageSrc) return;
        
        createOverlay();
        if (overlayImage && overlayContainer && loadingIndicator) {
            overlayImage.src = currentImageSrc;
            
            // Show loader, hide image while loading
            loadingIndicator.style.display = 'block';
            overlayContainer.style.display = 'none';
            updateOverlayPosition(lastX, lastY);
            
            // Wait for image to load to position it correctly, since we need its dimensions
            overlayImage.onload = () => {
                if (isHovering && currentImageSrc === overlayImage?.src) {
                    loadingIndicator!.style.display = 'none';
                    overlayContainer!.style.display = 'block';
                    updateOverlayPosition(lastX, lastY);
                }
            };
        }
    }, settings.store.hoverDelay);
}

function handleMouseMove(e: MouseEvent) {
    lastX = e.clientX;
    lastY = e.clientY;
    if (!isHovering) return;
    // Keep updating the recorded position just in case the image hasn't loaded yet
    // but the user is still moving the mouse
    updateOverlayPosition(lastX, lastY);
}

function handleMouseOut(e: MouseEvent) {
    isHovering = false;
    currentImageSrc = null;
    if (hoverTimeout) clearTimeout(hoverTimeout);
    removeOverlay();
}

export default definePlugin({
    name: "Imagus",
    description: "Hover over images to preview them in full size, similar to the Imagus extension.",
    tags: ["Media", "Utility"],
    authors: [{ name: "Saturn", id: 965286897662443570n }],
    
    settings,
    managedStyle,
    
    start() {
        document.addEventListener("mouseover", handleMouseOver);
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseout", handleMouseOut);
    },
    
    stop() {
        document.removeEventListener("mouseover", handleMouseOver);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseout", handleMouseOut);
        
        if (overlayContainer) {
            overlayContainer.remove();
            overlayContainer = null;
            overlayImage = null;
        }
        if (loadingIndicator) {
            loadingIndicator.remove();
            loadingIndicator = null;
        }
        if (hoverTimeout) clearTimeout(hoverTimeout);
    }
});
