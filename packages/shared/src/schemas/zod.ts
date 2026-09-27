import { z } from 'zod';

// Shared validation is rendered by both forms and API field errors.
z.setErrorMap((issue) => {
  if (issue.code === 'too_small')
    return {
      message: `La valeur doit contenir au moins ${String(issue.minimum)} ${issue.type === 'string' ? 'caractères' : 'éléments'}.`,
    };
  if (issue.code === 'too_big')
    return {
      message: `La valeur ne doit pas dépasser ${String(issue.maximum)} ${issue.type === 'string' ? 'caractères' : 'éléments'}.`,
    };
  if (issue.code === 'invalid_type')
    return { message: 'Ce champ est obligatoire et doit contenir une valeur valide.' };
  return { message: 'La valeur saisie est invalide.' };
});

export { z };
