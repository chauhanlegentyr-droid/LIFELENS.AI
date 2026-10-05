const demoAnalysis = {
  score: 61,

  summary:
    "The space is functional but has several movement, safety, and accessibility concerns.",

  issues: [
    {
      id: 1,
      title: "Partially blocked exit",
      severity: "high",
      x: 82,
      y: 18,
      description:
        "Furniture appears to reduce the usable space near the exit.",
      recommendation:
        "Move the nearby desk away from the doorway to create a clearer exit path.",
    },
    {
      id: 2,
      title: "Narrow central pathway",
      severity: "medium",
      x: 51,
      y: 55,
      description:
        "The arrangement creates a narrow route through the center of the room.",
      recommendation:
        "Rearrange the desks to create a wider continuous pathway.",
    },
    {
      id: 3,
      title: "Floor obstruction",
      severity: "medium",
      x: 31,
      y: 78,
      description:
        "Objects on the floor may interfere with movement.",
      recommendation:
        "Move bags and loose objects away from the walking area.",
    },
    {
      id: 4,
      title: "Desk arrangement",
      severity: "low",
      x: 63,
      y: 67,
      description:
        "The current desk arrangement creates unnecessary movement around the room.",
      recommendation:
        "Consider grouping desks into a more efficient arrangement.",
    },
  ],

  optimization: {
    score: 91,
    summary:
      "Rearranging three objects significantly improves movement through the space.",
  },
};

export default demoAnalysis;
