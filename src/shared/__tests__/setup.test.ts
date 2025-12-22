/**
 * Verify test setup is working correctly
 */
describe('Project Setup', () => {
  it('should have Jest configured correctly', () => {
    expect(true).toBe(true);
  });

  it('should have fast-check available for property testing', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fc = require('fast-check');
    expect(fc).toBeDefined();
    expect(typeof fc.property).toBe('function');
  });
});
