import fs from "fs/promises";
import path from "path";

const dataPath = path.join(process.cwd(), "data", "bookings.json");
const sessions = new Map();
const bookingCounterByIp = new Map();

async function ensureDataFile() {
  try {
    await fs.access(dataPath);
  } catch {
    await fs.mkdir(path.dirname(dataPath), { recursive: true });
    await fs.writeFile(dataPath, "[]", "utf-8");
  }
}

export async function listBookings() {
  await ensureDataFile();
  const raw = await fs.readFile(dataPath, "utf-8");
  const list = JSON.parse(raw);
  return Array.isArray(list) ? list : [];
}

export async function saveBookings(list) {
  await ensureDataFile();
  await fs.writeFile(dataPath, JSON.stringify(list, null, 2), "utf-8");
}

export async function addBooking(booking) {
  const list = await listBookings();
  list.push(booking);
  await saveBookings(list);
  return booking;
}

export async function getBookingById(id) {
  const list = await listBookings();
  return list.find((b) => b.id === id) || null;
}

export async function markReminderSent(bookingId) {
  const list = await listBookings();
  const item = list.find((b) => b.id === bookingId);
  if (!item) return;
  item.reminderSent = true;
  await saveBookings(list);
}

export function getSession(sessionId) {
  return sessions.get(sessionId);
}

export function setSession(sessionId, session) {
  sessions.set(sessionId, session);
}

export function canCreateBooking(ip) {
  const key = `${new Date().toISOString().slice(0, 10)}:${ip || "unknown"}`;
  const count = bookingCounterByIp.get(key) || 0;
  return count < 3;
}

export function increaseBookingCounter(ip) {
  const key = `${new Date().toISOString().slice(0, 10)}:${ip || "unknown"}`;
  const count = bookingCounterByIp.get(key) || 0;
  bookingCounterByIp.set(key, count + 1);
}
