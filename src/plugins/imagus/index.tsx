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
let currentMediaSrc: string | null = null;
let overlayContainer: HTMLDivElement | null = null;
let overlayImage: HTMLImageElement | null = null;
let overlayVideo: HTMLVideoElement | null = null;
let loadingIndicator: HTMLDivElement | null = null;
let isHovering = false;
let lastX = 0;
let lastY = 0;

interface MediaResult {
    src: string;
    isVideo: boolean;
    originalVideo?: HTMLVideoElement;
}

function getHighResUrl(url: string): string {
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname === 'media.discordapp.net') {
            urlObj.searchParams.delete('width');
            urlObj.searchParams.delete('height');
        } else if (urlObj.hostname === 'cdn.discordapp.com') {
            urlObj.searchParams.set('size', '4096');
        }
        return urlObj.toString();
    } catch {
        return url;
    }
}

function extractMediaSrc(target: HTMLElement): MediaResult | null {
    if (target.tagName === 'VIDEO') {
        const vid = target as HTMLVideoElement;
        if (vid.src) return { src: vid.src, isVideo: true, originalVideo: vid };
    }
    
    if (target.tagName === 'IMG') {
        return { src: (target as HTMLImageElement).src, isVideo: false };
    }
    
    const bgImg = window.getComputedStyle(target).backgroundImage;
    if (bgImg && bgImg !== 'none' && bgImg.includes('url(')) {
        const match = bgImg.match(/url\(['"]?(.*?)['"]?\)/);
        if (match) return { src: match[1], isVideo: false };
    }
    
    const anchor = target.closest('a');
    if (anchor) {
        const vid = anchor.querySelector('video');
        if (vid && vid.src) return { src: vid.src, isVideo: true, originalVideo: vid };
        
        const img = anchor.querySelector('img');
        if (img) return { src: img.src, isVideo: false };
        
        const href = anchor.href;
        if (href && (href.match(/\.(png|jpg|jpeg|webp|gif)$/i) || href.includes('media.discordapp.net'))) {
            return { src: href, isVideo: false };
        }
    }
    
    const rect = target.getBoundingClientRect();
    if (rect.width < 600 && rect.height < 600) {
        const vid = target.querySelector('video');
        if (vid && vid.src) return { src: vid.src, isVideo: true, originalVideo: vid };
        
        const img = target.querySelector('img');
        if (img) return { src: img.src, isVideo: false };
    }
    
    const parent = target.parentElement;
    if (parent) {
        const pRect = parent.getBoundingClientRect();
        if (pRect.width < 600 && pRect.height < 600) {
            const vid = parent.querySelector('video');
            if (vid && vid.src) return { src: vid.src, isVideo: true, originalVideo: vid };
            
            const img = parent.querySelector('img');
            if (img) return { src: img.src, isVideo: false };
        }
    }

    return null;
}

function createOverlay() {
    if (!overlayContainer) {
        overlayContainer = document.createElement("div");
        overlayContainer.id = "vc-imagus-overlay";
        
        overlayImage = document.createElement("img");
        
        overlayVideo = document.createElement("video");
        overlayVideo.loop = true;
        overlayVideo.muted = true;
        
        overlayContainer.appendChild(overlayImage);
        overlayContainer.appendChild(overlayVideo);
        
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
        if (overlayImage) {
            overlayImage.src = '';
            overlayImage.style.display = 'none';
        }
        if (overlayVideo) {
            overlayVideo.pause();
            overlayVideo.src = '';
            overlayVideo.style.display = 'none';
        }
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

    if (!overlayContainer || overlayContainer.style.display === 'none') return;
    
    const activeMedia = (overlayImage && overlayImage.style.display === 'block') ? overlayImage : overlayVideo;
    if (!activeMedia) return;

    const offset = 15;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    const mediaWidth = activeMedia.offsetWidth;
    const mediaHeight = activeMedia.offsetHeight;
    
    if (mediaWidth === 0 || mediaHeight === 0) return;

    let left = x + offset;
    let top = y + offset;
    
    if (left + mediaWidth > viewportWidth) {
        left = x - offset - mediaWidth;
    }
    if (left < 0) left = 0;

    if (top + mediaHeight > viewportHeight) {
        top = y - offset - mediaHeight;
    }
    if (top < 0) top = 0;
    
    overlayContainer.style.left = `${left}px`;
    overlayContainer.style.top = `${top}px`;
}

function handleMouseOver(e: MouseEvent) {
    const target = e.target as HTMLElement;
    lastX = e.clientX;
    lastY = e.clientY;
    
    const media = extractMediaSrc(target);
    if (!media) return;

    if (target.classList.contains("emoji") || media.src.includes("/assets/")) return;

    // Ignore if inside a native media modal (carousel modal / media viewer)
    if (target.closest('[class*="carouselModal" i], [class*="modalCarouselWrapper" i], [class*="mediaViewer" i]')) return;

    isHovering = true;
    currentMediaSrc = getHighResUrl(media.src);

    if (hoverTimeout) clearTimeout(hoverTimeout);
    
    hoverTimeout = setTimeout(() => {
        if (!isHovering || !currentMediaSrc) return;
        
        // If it's a video, verify it is actually playing right now
        // This avoids blowing up paused videos, but still allows GIFs to blow up
        if (media.isVideo && media.originalVideo && media.originalVideo.paused) {
            return;
        }
        
        createOverlay();
        if (overlayContainer && loadingIndicator && overlayImage && overlayVideo) {
            loadingIndicator.style.display = 'block';
            overlayContainer.style.display = 'none';
            overlayImage.style.display = 'none';
            overlayVideo.style.display = 'none';
            updateOverlayPosition(lastX, lastY);
            
            if (media.isVideo && media.originalVideo) {
                overlayVideo.src = currentMediaSrc;
                overlayVideo.onloadeddata = () => {
                    if (isHovering && currentMediaSrc === overlayVideo?.src) {
                        loadingIndicator!.style.display = 'none';
                        overlayVideo!.style.display = 'block';
                        overlayContainer!.style.display = 'block';
                        
                        // Sync the preview to the original playing video
                        if (media.originalVideo) {
                            overlayVideo!.currentTime = media.originalVideo.currentTime;
                        }
                        
                        overlayVideo!.play();
                        updateOverlayPosition(lastX, lastY);
                    }
                };
            } else {
                overlayImage.src = currentMediaSrc;
                overlayImage.onload = () => {
                    if (isHovering && currentMediaSrc === overlayImage?.src) {
                        loadingIndicator!.style.display = 'none';
                        overlayImage!.style.display = 'block';
                        overlayContainer!.style.display = 'block';
                        updateOverlayPosition(lastX, lastY);
                    }
                };
            }
        }
    }, settings.store.hoverDelay);
}

function handleMouseMove(e: MouseEvent) {
    lastX = e.clientX;
    lastY = e.clientY;
    if (!isHovering) return;
    updateOverlayPosition(lastX, lastY);
}

function handleMouseOut(e: MouseEvent) {
    isHovering = false;
    currentMediaSrc = null;
    if (hoverTimeout) clearTimeout(hoverTimeout);
    removeOverlay();
}

export default definePlugin({
    name: "Imagus",
    description: "Hover over images and playing videos to preview them in full size, similar to the Imagus extension.",
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
            overlayVideo = null;
        }
        if (loadingIndicator) {
            loadingIndicator.remove();
            loadingIndicator = null;
        }
        if (hoverTimeout) clearTimeout(hoverTimeout);
    }
});
