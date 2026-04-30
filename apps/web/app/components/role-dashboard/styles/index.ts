import cards from "./cards.module.css";
import columnAppList from "./column-app-list.module.css";
import columnCards from "./column-cards.module.css";
import columnTrack from "./column-track.module.css";
import enableControls from "./enable-controls.module.css";
import enableOverlays from "./enable-overlays.module.css";
import list from "./list.module.css";
import logo from "./logo.module.css";
import modalTabs from "./modal-tabs.module.css";
import modals from "./modals.module.css";

const styles: Record<string, string> = {
  ...cards,
  ...enableControls,
  ...enableOverlays,
  ...list,
  ...columnTrack,
  ...columnCards,
  ...columnAppList,
  ...logo,
  ...modals,
  ...modalTabs,
};

export default styles;
