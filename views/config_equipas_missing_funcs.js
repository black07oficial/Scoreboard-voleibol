
var configEquipaTime01;
var configEquipaTime02;

async function getConfigEquipaTime(id) {
    const db = new sqlite3.Database(dbPath);
    _ = await db.serialize(() => {
        db.all("SELECT * FROM config_equipas_times where id =" + id, (err, rows) => {
            if (err) {
                console.error(err.message);
            }
            if (id === "1") {
                configEquipaTime01 = rows;
            } else {
                configEquipaTime02 = rows;
            }
            loadConfigEquipaTime(id);
        });
    });
    db.close();
}

function loadConfigEquipaTime(equipeId) {
    var configuration = equipeId === "1" ? configEquipaTime01 : configEquipaTime02;

    if (configuration && configuration.length > 0) {
        var suffix = equipeId === "1" ? "t1" : "t2";
        var nomeElem = document.querySelector("#edit-cfg-equipes-" + suffix + "-nome");
        var abrevElem = document.querySelector("#edit-cfg-equipes-" + suffix + "-abrev");

        if (nomeElem) nomeElem.value = configuration[0].nome;
        if (abrevElem) abrevElem.value = configuration[0].abreviatura;

        // Logo logic if exists
        var imgElem = document.querySelector("#img-cfg-equipes-" + suffix + "-logo");
        if (imgElem && configuration[0].logo_caminho) {
            imgElem.setAttribute('src', configuration[0].logo_caminho);
        }
    }
}
