import styles from "../../deployment/workspace/Main.module.css";

export default function IntroPanel() {
  return (
    <div className={styles.introPanel}>
      <h3 className={styles.placeholderTitle}>Welcome to your deployment workspace</h3>
      <p className={styles.placeholderCopy}>
        Placeholder: Hier kommt eine kurze Einfuehrung zum Ablauf von
        Software-Auswahl, Hardware-Konfiguration, Inventory und Setup hinein.
      </p>
      <div className={styles.introVideoWrap}>
        <iframe
          title="2026-02-18 13-25-09"
          src="https://video.infinito.nexus/videos/embed/5YmUZYWUaaNcEy5vH5pHrQ"
          frameBorder="0"
          allowFullScreen
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          className={styles.introVideo}
        />
      </div>
      <p className={styles.placeholderCopy}>
        Placeholder: In einem naechsten Schritt koennen wir hier auch eine
        Checkliste mit den wichtigsten ersten Schritten ergaenzen.
      </p>
    </div>
  );
}
