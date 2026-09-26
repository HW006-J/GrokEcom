// Demo data for the UI-first build. Track A replaces this with real detections.
export type ScannedObject = {
  id: string;
  name: string;
  category: string;
  image: string;        // cutout or light-background product shot
  low: number;          // GBP estimate range
  high: number;
  condition: string;
  blurb: string;
  picked: boolean;
};

export const MOCK_OBJECTS: ScannedObject[] = [
  {
    id: "lamp",
    name: "Ceramic table lamp",
    category: "Lighting",
    image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=700&q=80",
    low: 65, high: 90,
    condition: "Very good",
    blurb: "Fluted ceramic base with a pleated linen shade. Warm, soft light.",
    picked: true,
  },
  {
    id: "camera",
    name: "35mm rangefinder camera",
    category: "Tech",
    image: "https://images.unsplash.com/photo-1495121605193-b116b5b9c5fe?w=700&q=80",
    low: 120, high: 180,
    condition: "Good, light brassing",
    blurb: "Fully mechanical rangefinder with a fast 40mm lens. Shutter accurate.",
    picked: true,
  },
  {
    id: "chair",
    name: "Mid-century lounge chair",
    category: "Furniture",
    image: "https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=700&q=80",
    low: 180, high: 260,
    condition: "Very good",
    blurb: "Solid walnut frame, olive wool cushions. No wobble, no marks.",
    picked: true,
  },
  {
    id: "coat",
    name: "Waxed field jacket",
    category: "Clothing",
    image: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=700&q=80",
    low: 55, high: 85,
    condition: "Good",
    blurb: "Olive waxed cotton, corduroy collar, size M. Ready to re-wax.",
    picked: true,
  },
  {
    id: "trainers",
    name: "Suede running trainers",
    category: "Footwear",
    image: "https://images.unsplash.com/photo-1539185441755-769473a23570?w=700&q=80",
    low: 45, high: 70,
    condition: "Worn twice",
    blurb: "UK 9, grey suede and mesh. Boxed with spare laces.",
    picked: false,
  },
];

export const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
