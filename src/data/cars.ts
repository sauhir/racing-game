import { BASE_STATS, type CarStats } from '../sim/car';

export interface CarModel {
  id: 'bubble' | 'van' | 'roadster' | 'buggy';
  name: string;
  blurb: string;
  stats: CarStats;
}

export const CARS: CarModel[] = [
  { id: 'bubble', name: 'Bubble', blurb: 'Balanced all-rounder', stats: BASE_STATS },
  {
    id: 'roadster', name: 'Dart', blurb: 'Fastest, but fragile',
    stats: { ...BASE_STATS, maxSpeed: 48, accel: 23, armour: 1.4 },
  },
  {
    id: 'buggy', name: 'Hopper', blurb: 'Quick off the line, nimble',
    stats: { ...BASE_STATS, maxSpeed: 44.8, accel: 30, turnRate: 3, armour: 1.15 },
  },
  {
    id: 'van', name: 'Hauler', blurb: 'Tough and heavy',
    stats: { ...BASE_STATS, maxSpeed: 45, accel: 21, turnRate: 2.55, armour: 0.6 },
  },
];

export const carById = (id: string): CarModel => CARS.find((c) => c.id === id) ?? CARS[0];
