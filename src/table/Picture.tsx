import { createSignal, splitProps } from "solid-js";
import type { JSX } from "solid-js";
import type { ArchivePhoto } from "../archive";
import { srcset, thumb } from "./media";

interface PictureProps {
  photo: ArchivePhoto;
  /** CSS width the image renders at, so the browser can pick a file. */
  sizes: string;
  alt: string;
  class?: string;
  eager?: boolean;
  priority?: boolean;
  ref?: (el: HTMLImageElement) => void;
  /** CSS background for the loupe's magnified view. */
  loupe?: string;
}

/** A responsive photograph that fades in once decoded. */
export default function Picture(props: PictureProps) {
  const [loaded, setLoaded] = createSignal(false);
  return <picture>
    <source type="image/avif" srcset={srcset(props.photo, "avif")} sizes={props.sizes} />
    <img
      ref={el => {
        props.ref?.(el);
        // A cached image can finish before Solid attaches the load handler.
        queueMicrotask(() => { if (el.complete && el.naturalWidth) setLoaded(true); });
      }}
      class={props.class}
      classList={{ "is-loaded": loaded() }}
      src={thumb(props.photo)}
      srcset={srcset(props.photo, "webp")}
      sizes={props.sizes}
      alt={props.alt}
      width={props.photo.width}
      height={props.photo.height}
      loading={props.eager ? "eager" : "lazy"}
      fetchpriority={props.priority ? "high" : "auto"}
      decoding="async"
      draggable={false}
      data-loupe={props.loupe}
      onLoad={() => setLoaded(true)}
    />
  </picture>;
}

/**
 * A small preview (transport chips, the preview strip): the 640 px AVIF the
 * contact sheets already fetched, so it usually comes from the cache.
 */
export function Thumb(props: { photo?: ArchivePhoto } & Omit<JSX.ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const [own, rest] = splitProps(props, ["photo"]);
  return <picture>
    <source type="image/avif" srcset={own.photo?.formats.avif?.thumb ?? ""} />
    <img {...rest} src={thumb(own.photo)} alt="" draggable={false} decoding="async" />
  </picture>;
}