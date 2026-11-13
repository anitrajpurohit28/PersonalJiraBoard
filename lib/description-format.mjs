export function validDescriptionFormat(value) {
  if (value !== 'todo' && value !== 'text') throw Object.assign(new Error('Choose Text or To-do list for the description.'), {status:400});
  return value;
}
export function descriptionFormatUpdate(id, value) {
  return { sql:'UPDATE tasks SET description_format = ? WHERE id = ?', params:[validDescriptionFormat(value),id] };
}
