import { useEffect, useRef } from 'react';

interface VideoTileProps {
  stream: MediaStream | null;
  /** Our own preview: silent (or we would hear ourselves) and flipped like a mirror. */
  isSelf: boolean;
  label: string;
  testId: string;
}

/** Plays one live video stream. */
export function VideoTile({ stream, isSelf, label, testId }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // A live stream cannot be given to <video> as an attribute; it must be set from code.
  useEffect(() => {
    const video = videoRef.current;
    if (video && video.srcObject !== stream) video.srcObject = stream;
  }, [stream]);

  return (
    <video
      ref={videoRef}
      className={isSelf ? 'video self' : 'video'}
      aria-label={label}
      data-testid={testId}
      autoPlay
      playsInline // stops iPhones from forcing the video into full screen
      muted={isSelf}
    />
  );
}
