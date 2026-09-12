import { UserDataSchema } from './src/lib/schema';
const parsed = UserDataSchema.parse({ activeWorkout: undefined });
console.log('Keys in parsed:', Object.keys(parsed));
console.log('Has activeWorkout:', 'activeWorkout' in parsed);
console.log('activeWorkout is undefined?', parsed.activeWorkout === undefined);
console.log('activeWorkout is null?', parsed.activeWorkout === null);
