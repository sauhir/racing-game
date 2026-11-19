import { describe, expect, it } from 'vitest';
import { Car, NO_INPUT, TUNING, type CarInput } from '../src/sim/car';

const DT = 1 / 60;
const drive = (car: Car, input: Partial<CarInput>, seconds: number): void => {
  for (let i = 0; i < seconds * 60; i++) car.step({ ...NO_INPUT, ...input }, DT);
};
const fresh = (): Car => new Car(0, 'Test', 0xffffff, true);

describe('Car', () => {
  it('accelerates to, but not past, top speed', () => {
    const car = fresh();
    drive(car, { throttle: 1 }, 1);
    expect(car.speed).toBeGreaterThan(15);
    drive(car, { throttle: 1 }, 9);
    expect(car.speed).toBeGreaterThan(TUNING.maxSpeed * 0.97);
    expect(car.speed).toBeLessThanOrEqual(TUNING.maxSpeed + 1e-6);
    expect(car.y).toBeCloseTo(0, 6);
  });

  it('brakes to a stop, then reverses', () => {
    const car = fresh();
    drive(car, { throttle: 1 }, 5);
    drive(car, { brake: 1 }, 1.2);
    expect(Math.abs(car.forwardSpeed)).toBeLessThan(6);
    drive(car, { brake: 1 }, 3);
    expect(car.forwardSpeed).toBeLessThan(-5);
    expect(car.forwardSpeed).toBeGreaterThanOrEqual(-TUNING.reverseSpeed - 1e-6);
  });

  it('steers towards increasing heading for positive steer', () => {
    const car = fresh();
    drive(car, { throttle: 1 }, 2);
    drive(car, { throttle: 1, steer: 0.4 }, 1);
    expect(car.heading).toBeGreaterThan(0.3);
    expect(car.y).toBeGreaterThan(0);
  });

  it('is slower off the road', () => {
    const car = fresh();
    car.offroad = true;
    drive(car, { throttle: 1 }, 10);
    expect(car.speed).toBeLessThan(TUNING.maxSpeed * TUNING.offroadSpeed + 0.5);
  });

  it('drifts on the handbrake, charging boost, and recovers afterwards', () => {
    const car = fresh();
    drive(car, { throttle: 1 }, 5);
    expect(car.drifting).toBe(false);
    expect(car.boost).toBe(0);
    drive(car, { throttle: 1, steer: 1, handbrake: true }, 0.5);
    expect(car.drifting).toBe(true);
    drive(car, { throttle: 1, steer: 1 }, 1);
    expect(car.boost).toBeGreaterThan(0.1);
    expect(car.slide).toBeGreaterThan(0.2);
    drive(car, { throttle: 1 }, 3);
    expect(car.drifting).toBe(false);
    expect(car.slide).toBe(0);
  });

  it('keeps a useful amount of speed through a drift', () => {
    const car = fresh();
    drive(car, { throttle: 1 }, 6);
    drive(car, { throttle: 1, steer: 1, handbrake: true }, 0.4);
    drive(car, { throttle: 1, steer: 1 }, 1.5);
    expect(car.speed).toBeGreaterThan(TUNING.maxSpeed * 0.5);
  });

  it('boost needs charge, exceeds normal top speed, and drains', () => {
    const car = fresh();
    drive(car, { throttle: 1, boost: true }, 8);
    expect(car.boosting).toBe(false);
    expect(car.speed).toBeLessThanOrEqual(TUNING.maxSpeed + 1e-6);

    car.boost = 1;
    drive(car, { throttle: 1, boost: true }, 1.5);
    expect(car.boosting).toBe(true);
    expect(car.speed).toBeGreaterThan(TUNING.maxSpeed * 1.1);
    drive(car, { throttle: 1, boost: true }, 2);
    expect(car.boost).toBe(0);
    expect(car.boosting).toBe(false);
    drive(car, { throttle: 1 }, 4);
    expect(car.speed).toBeLessThan(TUNING.maxSpeed + 0.5);
  });
});
