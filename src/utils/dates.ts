export const parseAndNormalizeToISO = (input: any): string => {
  if (!input && input !== 0) throw new Error("Fecha no proporcionada");
  const d = new Date(input);
  if (isNaN(d.getTime())) throw new Error("Fecha inválida");

  return d.toISOString();
};

export const isValidDate = (input: any): boolean => {
  try {
    const d = new Date(input);
    return !isNaN(d.getTime());
  } catch (e) {
    return false;
  }
};

export default { parseAndNormalizeToISO, isValidDate };
