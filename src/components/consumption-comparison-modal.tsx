
"use client"

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import React from 'react';

// Keeping props for type compatibility with the parent component
interface ConsumptionComparisonModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    history: any[];
    products: any[];
    kiosks: any[];
}

export const ConsumptionComparisonModal: React.FC<ConsumptionComparisonModalProps> = ({ open, onOpenChange }) => {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Test</DialogTitle>
                    <DialogDescription>
                        This is a temporary component to resolve a build error.
                    </DialogDescription>
                </DialogHeader>
                <div>
                    <p>If you are seeing this, the build was successful.</p>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
