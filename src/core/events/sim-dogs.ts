import { createDog, stepDog, type Dog, type DogOwner } from "../dogs";
import type { PedSim } from "../pedestrians";
import type { EventDogs } from "./dog-escape";

/**
 * Les chiens des promeneurs sans dessin (essais sans écran, endurances) : la même logique que `PedsController` (un chien par maître, qui le
 * suit ; les chiens des événements « montrés » à part), sur la vraie simulation des passants.
 */
export class SimDogs implements EventDogs {
  readonly dogs: Dog[] = [];
  /** Chiens montrés par un événement depuis le dernier `step`. */
  readonly shown: Dog[] = [];
  private readonly o: DogOwner = { x: 0, y: 0, heading: 0, speed: 0, sitting: false, fleeing: false };

  constructor(private readonly sim: PedSim) {}

  /** Un pas : chaque maître a son chien, qui le suit. */
  step(dt: number): void {
    const seen = new Set<number>(), o = this.o;
    this.sim.forEachDogOwner((slot, id, x, y, heading, speed, sitting, fleeing) => {
      Object.assign(o, { x, y, heading, speed, sitting, fleeing });
      let d = this.dogs.find((k) => k.slot === slot && k.owner === id);
      if (!d) {
        if (this.dogs.length >= 24) return;
        d = createDog(id, slot, o);
        this.dogs.push(d);
      }
      seen.add(slot);
      stepDog(d, o, dt);
    });
    for (let k = this.dogs.length - 1; k >= 0; k--) if (!seen.has(this.dogs[k]!.slot)) this.dogs.splice(k, 1);
    this.shown.length = 0;
  }

  owners(visit: (slot: number, x: number, y: number) => void): void {
    this.sim.forEachDogOwner((slot, _id, x, y, _h, _s, sitting) => {
      if (!sitting) visit(slot, x, y);
    });
  }

  detach(slot: number): Dog | null {
    const id = this.sim.idOf(slot);
    const k = this.dogs.findIndex((d) => d.slot === slot && d.owner === id);
    if (k < 0) return null;
    const [dog] = this.dogs.splice(k, 1);
    this.sim.dropDog(slot);
    return dog!;
  }

  attach(slot: number, dog: Dog): void {
    if (this.sim.modeOf(slot) < 0) return;
    this.sim.giveDog(slot);
    dog.slot = slot;
    dog.owner = this.sim.idOf(slot);
    if (!this.dogs.includes(dog)) this.dogs.push(dog);
  }

  show(dog: Dog): void {
    this.shown.push(dog);
  }
}
