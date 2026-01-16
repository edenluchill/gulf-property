// Type declarations for Leaflet Geoman
import * as L from 'leaflet';

declare module 'leaflet' {
  interface Map {
    pm: {
      addControls: (options?: any) => void;
      removeControls: () => void;
      setGlobalOptions: (options: any) => void;
      toggleControls: () => void;
      controlsVisible: () => boolean;
      Toolbar: any;
      Draw: any;
      Edit: any;
    };
  }

  interface Layer {
    pm: {
      enable: (options?: any) => void;
      disable: () => void;
      toggleEdit: (options?: any) => void;
      enabled: () => boolean;
      dragging: () => boolean;
    };
  }

  interface Polygon {
    pm: {
      enable: (options?: any) => void;
      disable: () => void;
      toggleEdit: (options?: any) => void;
      enabled: () => boolean;
      dragging: () => boolean;
    };
  }
}
