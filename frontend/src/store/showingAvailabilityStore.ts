import { create } from 'zustand';

export type DayOfWeek = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export const DAYS_OF_WEEK: DayOfWeek[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type ShowingSlot = {
  day: DayOfWeek;
  from: string; // "09:00"
  to: string;   // "18:00"
};

type ShowingAvailabilityStore = {
  availabilityByDeal: Record<string, ShowingSlot[]>;
  setAvailability: (dealId: string, slots: ShowingSlot[]) => void;
};

export const useShowingAvailabilityStore = create<ShowingAvailabilityStore>((set) => ({
  availabilityByDeal: {},
  setAvailability: (dealId, slots) =>
    set((state) => ({
      availabilityByDeal: { ...state.availabilityByDeal, [dealId]: slots },
    })),
}));
