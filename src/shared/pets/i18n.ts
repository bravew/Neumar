import type { TranslationKeys } from '@/config/locale';

import type { PetCatalogItem } from './catalog';

type PetText = Pick<PetCatalogItem, 'id' | 'greeting' | 'description'>;

export function getPetGreeting(pet: PetText, t: TranslationKeys): string {
  return t.pets.greetings[pet.id] ?? pet.greeting;
}

export function getPetDescription(pet: PetText, t: TranslationKeys): string {
  return t.pets.descriptions[pet.id] ?? pet.description;
}
