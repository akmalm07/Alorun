export class MissionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
