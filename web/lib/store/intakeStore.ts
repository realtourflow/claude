"use client";

import { create } from 'zustand';

export type IntakeData = {
  financingType?: 'cash' | 'loan';
  firstTimeHomeBuyer?: boolean;
  militaryService?: boolean;
  journeyStage?: 'active' | 'found_house' | 'under_contract' | 'next_year';
  bedrooms?: '1' | '2' | '3' | '4+';
  bathrooms?: '1' | '2' | '3+';
  propertyTypes?: string[];
  areasOfInterest?: string;
  garagePreference?: 'yes' | 'no' | 'nice_to_have';
  poolPreference?: 'yes' | 'no' | 'nice_to_have';
  schoolPreferences?: string;
  basementPreference?: 'yes' | 'no' | 'nice_to_have';
  otherNotes?: string;
  employmentType?: 'w2' | 'self' | 'both' | 'other';
  creditScore?: 'excellent' | 'good' | 'solid' | 'needs_work';
  grossMonthlyIncome?: string;
};

type DealIntake = {
  completed: boolean;
  currentStep: number;
  data: IntakeData;
};

const DEFAULT: DealIntake = { completed: false, currentStep: 0, data: {} };

type IntakeStore = {
  intakeByDeal: Record<string, DealIntake>;
  getIntake: (dealId: string) => DealIntake;
  setStep: (dealId: string, step: number) => void;
  updateData: (dealId: string, data: Partial<IntakeData>) => void;
  complete: (dealId: string) => void;
};

export const useIntakeStore = create<IntakeStore>((set, get) => ({
  intakeByDeal: {},

  getIntake: (dealId) => get().intakeByDeal[dealId] ?? DEFAULT,

  setStep: (dealId, step) =>
    set((state) => ({
      intakeByDeal: {
        ...state.intakeByDeal,
        [dealId]: { ...(state.intakeByDeal[dealId] ?? DEFAULT), currentStep: step },
      },
    })),

  updateData: (dealId, data) =>
    set((state) => {
      const cur = state.intakeByDeal[dealId] ?? DEFAULT;
      return {
        intakeByDeal: {
          ...state.intakeByDeal,
          [dealId]: { ...cur, data: { ...cur.data, ...data } },
        },
      };
    }),

  complete: (dealId) =>
    set((state) => ({
      intakeByDeal: {
        ...state.intakeByDeal,
        [dealId]: { ...(state.intakeByDeal[dealId] ?? DEFAULT), completed: true },
      },
    })),
}));
