
export interface LabelSize {
    id: string;
    name: string;
    width: number; // in mm
    height: number; // in mm
}

export const labelSizes: LabelSize[] = [
    { id: '6080', name: 'Pimaco 6080', width: 101.6, height: 33.9 },
    { id: '6081', name: 'Pimaco 6081', width: 66.7, height: 25.4 },
    { id: '6082', name: 'Pimaco 6082', width: 44.5, height: 12.7 },
    { id: 'A4250', name: 'Pimaco A4250', width: 25.4, height: 10.0 },
    { id: 'A4251', name: 'Pimaco A4251', width: 33.9, height: 101.6 },
    { id: '30x50', name: 'Custom 50x30mm', width: 50, height: 30 },
];
