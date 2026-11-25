import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * The Home message this person closed (owner choice 2: closed until a new
 * message is posted). Only the id is kept: a new message has a new id and
 * shows again.
 */
export interface HomeNoticeState {
  hiddenNoticeId: string | null;
  hide: (noticeId: string) => void;
}

export const useHomeNoticeStore = create<HomeNoticeState>()(
  persist(
    (set) => ({
      hiddenNoticeId: null,
      hide: (noticeId) => set({ hiddenNoticeId: noticeId }),
    }),
    {
      name: "bumelerze.home-notice",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ hiddenNoticeId: state.hiddenNoticeId }),
    },
  ),
);
