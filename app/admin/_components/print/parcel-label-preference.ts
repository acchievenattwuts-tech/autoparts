"use client";

import {
  PARCEL_LABEL_DEFAULT_SIZE,
  parseParcelLabelSize,
  type ParcelLabelSize,
} from "./parcel-label";

/**
 * จำขนาดกระดาษที่เลือกล่าสุดไว้ในเครื่องผู้ใช้ เพื่อไม่ต้องเลือกซ้ำทุกครั้งที่พิมพ์
 *
 * เปิดเป็น external store ให้ `useSyncExternalStore` อ่าน แทนที่จะอ่านใน effect
 * แล้ว setState — เพราะฝั่ง server ไม่มี localStorage ค่าตั้งต้นจึงต้องต่างจากฝั่ง
 * client ได้โดยไม่เกิด hydration mismatch ซึ่ง `getServerSnapshot` จัดการให้อยู่แล้ว
 *
 * ทุกการเรียกถูกครอบ try/catch เพราะ localStorage โยน error ได้เมื่อเบราว์เซอร์
 * ปิดการเก็บข้อมูลเว็บไซต์ — กรณีนั้นให้ตกกลับไปใช้ค่าเริ่มต้นเงียบๆ
 */
const STORAGE_KEY = "parcel-label-size";

const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

/** ให้ปุ่มทุกตัวในหน้า (และแท็บอื่น) เห็นค่าเดียวกันเสมอ */
export const subscribeParcelLabelSize = (onStoreChange: () => void): (() => void) => {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);

  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
};

export const getParcelLabelSizeSnapshot = (): ParcelLabelSize => {
  try {
    return parseParcelLabelSize(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return PARCEL_LABEL_DEFAULT_SIZE;
  }
};

/** ฝั่ง server ยังไม่รู้ค่าที่จำไว้ — เรนเดอร์ค่าเริ่มต้นไปก่อนเสมอ */
export const getParcelLabelSizeServerSnapshot = (): ParcelLabelSize => PARCEL_LABEL_DEFAULT_SIZE;

export const rememberParcelLabelSize = (size: ParcelLabelSize): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, size);
  } catch {
    // เก็บไม่ได้ก็ไม่เป็นไร — ผู้ใช้แค่ต้องเลือกขนาดใหม่ในครั้งถัดไป
  }

  notify();
};
