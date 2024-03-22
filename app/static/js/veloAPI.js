let artifactName = "Custom.Windows.EventLogs.Blauhaunt"
let url = window.location.origin
let header = {}
checkForVelociraptor()

function selectionModal(title, selectionList) {
    // remove duplicates from selectionList
    selectionList = [...new Set(selectionList)]
    let modal = new Promise((resolve, reject) => {
        // create modal
        let modal = document.createElement("div");
        modal.id = "modal";
        modal.className = "modal";
        let modalContent = document.createElement("div");
        modalContent.className = "modal-content";
        let modalHeader = document.createElement("h2");
        modalHeader.innerHTML = title;
        modalContent.appendChild(modalHeader);
        let modalBody = document.createElement("div");
        modalBody.className = "modal-body";
        selectionList.forEach(option => {
            let notebookButton = document.createElement("button");
            notebookButton.innerHTML = option;
            notebookButton.onclick = function () {
                modal.remove();
                return option;
            }
            modalBody.appendChild(notebookButton);
        });
        modalContent.appendChild(modalBody);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        // show modal
        modal.style.display = "block";
        // close modal when clicked outside of it
        window.onclick = function (event) {
            if (event.target === modal) {
                modal.remove();
                return null;
            }
        }
    });
    return modal;
}

function getNotebook(huntID) {
    let notebooks = []
    fetch(url + '/api/v1/GetHunt?hunt_id=' + huntID, {headers: header}).then(response => {
        return response.json()
    }).then(data => {
        let artifacts = data.artifacts;
        let notebookID = ""
        artifacts.forEach(artifact => {
            notebookID = "N." + huntID
            if (artifact === artifactName) {
                notebooks.push(notebookID);
            }
        });
        // if there are more notebooks wit the artifact name, show a modal to select the notebook to use
        if (notebooks.length > 1) {
            selectionModal("Select Notebook", notebooks).then(selectedNotebook => {
                if (selectedNotebook === null) {
                    return;
                }
                getCells(selectedNotebook);
            });
        } else {
            getCells(notebookID);
        }
    });
}

function getCells(notebookID) {
    fetch(url + `/api/v1/GetNotebooks?notebook_id=${notebookID}&include_uploads=true`, {headers: header}).then(response => {
        return response.json()
    }).then(data => {
        let cells = data.items;
        if (cells.length > 1) {
            let cellIDs = {}
            cells.forEach(cell => {
                cell.cell_metadata.forEach(metadata => {
                    let suffix = ""
                    let i = 0
                    while (cellIDs[metadata.cell_id + suffix] !== undefined) {
                        suffix = "_" + i
                    }
                    cellIDs[metadata.cell_id + suffix] = {cell_id: metadata.cell_id, version: metadata.timestamp};
                });
            });
            selectionModal("Select Cell", cellIDs.keys()).then(selectedCell => {
                if (selectedCell === null) {
                    return;
                }
                loadData(notebookID, cellIDs[selectedCell].cell_id, cellIDs[selectedCell].version);
            });
        }
        cells.forEach(cell => {
            cell.cell_metadata.forEach(metadata => {
                loadData(notebookID, metadata.cell_id, metadata.timestamp);
            });
        });
    });
}

function updateData(notebookID, cellID, version) {
    fetch(url + '/api/v1/UpdateNotebookCell', {
        method: 'POST',
        headers: header,
        body: JSON.stringify({
            "notebook_id": notebookID,
            "cell_id": cellID,
            "env": [{"key": "ArtifactName", "value": artifactName}],
            "input": "\n/*\n# BLAUHAUNT\n*/\nSELECT * FROM source(artifact=\"" + artifactName + "\")\n"
        })
    }).then(response => {
        return response.json()
    }).then(data => {
        loadData(notebookID, cellID, version);
    });
}

let dataRows = []

function loadData(notebookID, cellID, version) {
    fetch(url + `/api/v1/GetTable?notebook_id=${notebookID}&client_id=&cell_id=${cellID}&table_id=1&TableOptions=%7B%7D&Version=${version}&start_row=0&rows=100&sort_direction=false`,
        {headers: header}
    ).then(response => {
        return response.json()
    }).then(data => {
        data.rows.forEach(row => {
            row = row.cell;
            let entry = {}
            for (i = 0; i < row.length; i++) {
                entry[data.columns[i]] = row[i];
            }
            dataRows.push(JSON.stringify(entry));
            dataRows.push(jsonRow);
        });
        processJSONUpload(dataRows.join("\n"));
    });
}

function getHunts(orgID) {
    url = window.location.origin
    fetch(url + '/api/v1/ListHunts?count=2000&offset=0&summary=true&user_filter=', {headers: header}).then(response => {
        return response.json()
    }).then(data => {
        let hunts = data.items;
        hunts.forEach(hunt => {
            getNotebook(hunt.hunt_id);
        });
    })
}


function checkForVelociraptor() {
    fetch(url + '/api/v1/GetUserUITraits', {headers: header}).then(response => {
        return response.json()
    }).then(data => {
        let orgID = data.interface_traits.org;
        header = {"Grpc-Metadata-Orgid": orgID}
        // hide the Upload button
        document.getElementById("uploadBtn").style.display = "none";
        document.getElementById("casesBtnGrp").style.display = "none";
        getHunts(orgID);
    }).catch(error => {
        console.log("seems to be not connected to Velociraptor.");
    });
}