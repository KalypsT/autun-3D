import type { SeatDef } from "../core/seats";

/**
 * Places assises déclarées pendant la construction d'une tuile (D198) : bancs (`props.ts`) et chaises de terrasse (`shopfront.ts`).
 * Une seule tuile se construit à la fois : la construction ouvre la liste (`openSeats`), les dessinateurs y ajoutent, la construction la reprend.
 */
let sink: SeatDef[] | null = null;

export function openSeats(): SeatDef[] {
  return (sink = []);
}

export function closeSeats(): void {
  sink = null;
}

export function pushSeat(...s: SeatDef[]): void {
  sink?.push(...s);
}
