export interface TemplateProperty {
  id: string;
  label: string;
  type: 'select' | 'number' | 'boolean';
  default: string | number | boolean;
  unit?: string;
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
}

export const PRODUCTION_PROPERTIES: TemplateProperty[] = [
  {
    id: 'pgm_resolution',
    label: 'PGM Resolution',
    type: 'select',
    default: '1280x720',
    options: [
      { value: '3840x2160', label: '4K (3840×2160)' },
      { value: '1920x1080', label: 'HD (1920×1080)' },
      { value: '1280x720',  label: '720p (1280×720)' },
      { value: '720x576',   label: 'SD PAL (720×576)' },
      { value: '720x480',   label: 'SD NTSC (720×480)' },
      { value: '640x360',   label: 'Low (640×360)' },
      { value: '320x240',   label: 'Very Low (320×240)' },
    ],
  },
  {
    id: 'multiview_resolution',
    label: 'Multiview Resolution',
    type: 'select',
    default: '1280x720',
    options: [
      { value: '3840x2160', label: '4K (3840×2160)' },
      { value: '1920x1080', label: 'HD (1920×1080)' },
      { value: '1280x720',  label: '720p (1280×720)' },
      { value: '720x576',   label: 'SD PAL (720×576)' },
      { value: '720x480',   label: 'SD NTSC (720×480)' },
      { value: '640x360',   label: 'Low (640×360)' },
      { value: '320x240',   label: 'Very Low (320×240)' },
    ],
  },
  {
    id: 'pgm_framerate',
    label: 'PGM Frame Rate',
    type: 'select',
    default: '25/1',
    options: [
      { value: '10/1',       label: '10 fps' },
      { value: '15/1',       label: '15 fps' },
      { value: '24000/1001', label: '23.976 fps' },
      { value: '24/1',       label: '24 fps' },
      { value: '25/1',       label: '25 fps' },
      { value: '30000/1001', label: '29.97 fps' },
      { value: '30/1',       label: '30 fps' },
      { value: '50/1',       label: '50 fps' },
      { value: '60000/1001', label: '59.94 fps' },
      { value: '60/1',       label: '60 fps' },
    ],
  },
  {
    id: 'multiview_framerate',
    label: 'Multiview Frame Rate',
    type: 'select',
    default: '25/1',
    options: [
      { value: '10/1',       label: '10 fps' },
      { value: '15/1',       label: '15 fps' },
      { value: '24000/1001', label: '23.976 fps' },
      { value: '24/1',       label: '24 fps' },
      { value: '25/1',       label: '25 fps' },
      { value: '30000/1001', label: '29.97 fps' },
      { value: '30/1',       label: '30 fps' },
      { value: '50/1',       label: '50 fps' },
      { value: '60000/1001', label: '59.94 fps' },
      { value: '60/1',       label: '60 fps' },
    ],
  },
  {
    id: 'bitrate',
    label: 'PGM Encoder Bitrate',
    type: 'number',
    default: 4000,
    unit: 'kbps',
    min: 100,
    max: 100000,
  },
  {
    id: 'multiview_bitrate',
    label: 'Multiview Encoder Bitrate',
    type: 'number',
    default: 4000,
    unit: 'kbps',
    min: 100,
    max: 100000,
  },
  {
    id: 'num_aux_buses',
    label: 'AUX Buses',
    type: 'select',
    default: '2',
    options: [
      { value: '0', label: 'None' },
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '4', label: '4' },
    ],
  },
  {
    id: 'num_groups',
    label: 'Group Buses',
    type: 'select',
    default: '2',
    options: [
      { value: '0', label: 'None' },
      { value: '1', label: '1' },
      { value: '2', label: '2' },
      { value: '4', label: '4' },
    ],
  },
  {
    id: 'num_pips',
    label: 'PiP Slots',
    type: 'number',
    default: 0,
    min: 0,
    max: 16,
  },
  {
    id: 'ebu_main',
    label: 'EBU R128 Meter on Main',
    type: 'boolean',
    default: false,
  },
  {
    id: 'mix_latency',
    label: 'Mix Latency',
    type: 'number',
    default: 100,
    unit: 'ms',
    min: 0,
    max: 2000,
  },
  {
    id: 'clock',
    label: 'Flow Clock',
    type: 'select',
    default: '',
    options: [
      { value: '',    label: 'Default (monotonic)' },
      { value: 'tai', label: 'TAI — synchronise EFP sources by absolute timestamp' },
    ],
  },
];
