(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LineupPositions = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function capitalize(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function getLineRole(lineIndex, totalLines) {
    if (totalLines <= 1) return 'midfield';
    if (lineIndex === 0) return 'defense';
    if (lineIndex === totalLines - 1) return 'attack';
    return 'midfield';
  }

  function rowPositionLabels(count, lineRole) {
    var roleNoun = {
      defense: 'obránec',
      midfield: 'záložník',
      attack: 'útočník',
    };
    var noun = roleNoun[lineRole] || 'hráč';

    if (count === 1) return ['Střední ' + noun];
    if (count === 2) return ['Levý ' + noun, 'Pravý ' + noun];
    if (count === 3) return ['Levý ' + noun, 'Střední ' + noun, 'Pravý ' + noun];
    if (count === 4) {
      return ['Levý ' + noun, 'Střední ' + noun, 'Střední ' + noun, 'Pravý ' + noun];
    }
    if (count === 5) {
      return [
        'Levý ' + noun,
        'Levý střední ' + noun,
        'Střední ' + noun,
        'Pravý střední ' + noun,
        'Pravý ' + noun,
      ];
    }

    var out = [];
    for (var i = 0; i < count; i += 1) {
      out.push(capitalize(noun) + ' ' + (i + 1));
    }
    return out;
  }

  function positionLabelsForFormation(lines) {
    if (!Array.isArray(lines) || !lines.length) return ['Brankář'];
    var labels = ['Brankář'];
    var totalLines = lines.length;
    for (var li = 0; li < lines.length; li += 1) {
      var role = getLineRole(li, totalLines);
      var rowLabels = rowPositionLabels(lines[li], role);
      for (var ri = 0; ri < rowLabels.length; ri += 1) {
        labels.push(rowLabels[ri]);
      }
    }
    return labels;
  }

  return {
    positionLabelsForFormation: positionLabelsForFormation,
  };
});
