"use client";

import styles from "../styles";

type RoleVideoModalProps = {
  activeVideo: {
    url: string;
    title: string;
  } | null;
  onClose: () => void;
};

export default function RoleVideoModal({
  activeVideo,
  onClose,
}: RoleVideoModalProps) {
  if (!activeVideo) return null;

  return (
    <div onClick={onClose} className={styles.videoModalOverlay}>
      <div
        onClick={(event) => event.stopPropagation()}
        className={styles.videoModalCard}
      >
        <div className={styles.videoModalHeader}>
          <span className={styles.videoModalTitle}>{activeVideo.title}</span>
          <button onClick={onClose} className={styles.videoModalClose}>
            Close
          </button>
        </div>
        <div className={styles.videoFrameWrap}>
          <iframe
            src={activeVideo.url}
            title={activeVideo.title}
            allow="autoplay; encrypted-media"
            allowFullScreen
            className={styles.videoFrame}
          />
        </div>
      </div>
    </div>
  );
}
