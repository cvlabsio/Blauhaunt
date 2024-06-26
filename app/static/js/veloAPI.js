let artifactName = "Custom.Windows.EventLogs.Blauhaunt"
let monitoringArtifact = "Custom.Windows.Events.Blauhaunt"
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
        if (notebooks.length === 0) {
            return;
        }
        // if there are more notebooks wit the artifact name, show a modal to select the notebook to use
        if (notebooks.length > 1) {
            selectionModal("Select Notebook", notebooks).then(selectedNotebook => {
                if (selectedNotebook === null) {
                    return;
                }
                getCells(selectedNotebook);
            });
        } else {
            getCells(notebooks[0]);
        }
    });
}

function getCells(notebookID) {
    fetch(url + `/api/v1/GetNotebooks?notebook_id=${notebookID}&include_uploads=true`, {headers: header}).then(response => {
        // get the X-Csrf-Token form the header of the response
        localStorage.setItem('csrf-token', response.headers.get("X-Csrf-Token"))
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
                updateData(notebookID, cellIDs[selectedCell].cell_id, cellIDs[selectedCell].version, localStorage.getItem('csrf-token'));
            });
        }
        cells.forEach(cell => {
            cell.cell_metadata.forEach(metadata => {
                updateData(notebookID, metadata.cell_id, metadata.timestamp, localStorage.getItem('csrf-token'));
            });
        });
    });
}

function updateData(notebookID, cellID, version, csrf_token) {
    header["X-Csrf-Token"] = csrf_token
    fetch(url + '/api/v1/UpdateNotebookCell', {
        method: 'POST',
        headers: header,
        body: JSON.stringify({
            "notebook_id": notebookID,
            "cell_id": cellID,
            "env": [{"key": "ArtifactName", "value": artifactName}],
            "input": "\n/*\n# BLAUHAUNT\n*/\nSELECT * FROM source(artifact=\"" + artifactName + "\")\n",
            "type": "vql"
        })
    }).then(response => {
        return response.json()
    }).then(data => {

        loadData(notebookID, cellID, version);
    });
}

let dataRows = []

function loadData(notebookID, cellID, version, startRow = 0, toRow = 1000) {
    fetch(url + `/api/v1/GetTable?notebook_id=${notebookID}&client_id=&cell_id=${cellID}&table_id=1&TableOptions=%7B%7D&Version=${version}&start_row=${startRow}&rows=${toRow}&sort_direction=false`,
        {headers: header}
    ).then(response => {
        return response.json()
    }).then(data => {
        if (data.rows === undefined) {
            return;
        }
        data.rows.forEach(row => {
            row = row.cell;
            let entry = {}
            for (i = 0; i < row.length; i++) {
                if (data.columns[i] === "LogonTimes") {
                    entry[data.columns[i]] = JSON.parse(row[i]);
                    continue;
                }
                entry[data.columns[i]] = row[i];
            }
            dataRows.push(JSON.stringify(entry));
        });
        // show loading spinner
        document.getElementById("loading").style.display = "block";
        processJSONUpload(dataRows.join("\n")).then(() => {
            document.getElementById("loading").style.display = "none";
        });
        // if there are more rows, load them
        if (data.total_rows > toRow) {
            loadData(notebookID, cellID, version, startRow + toRow, toRow + 1000);
        }
        storeDataToIndexDB(header["Grpc-Metadata-Orgid"]);
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

function updateClientInfoData(clientInfoNotebook, cellID, version, csrf_token) {
    header["X-Csrf-Token"] = csrf_token
    fetch(url + '/api/v1/UpdateNotebookCell', {
        method: 'POST',
        headers: header,
        body: JSON.stringify({
            "notebook_id": clientInfoNotebook,
            "cell_id": cellID,
            "env": [{"key": "ArtifactName", "value": artifactName}],
            "input": "SELECT * FROM clients()\n",
            "type": "vql"
        })
    }).then(response => {
        return response.json()
    }).then(data => {
        loadFromClientInfoCell(clientInfoNotebook, cellID, version);
    });
}

function getClientInfoFromVelo() {
    fetch(url + '/api/v1/GetNotebooks?count=1000&offset=0', {headers: header}).then(response => {
        localStorage.setItem('csrf-token', response.headers.get("X-Csrf-Token"))
        return response.json()
    }).then(data => {
        let notebooks = data.items;
        if (!notebooks) {
            return false;
        }
        let clientInfoNotebook = ""
        notebooks.forEach(notebook => {
            let notebookID = notebook.notebook_id;
            notebook.cell_metadata.forEach(metadata => {
                let cellID = metadata.cell_id;
                fetch(url + `/api/v1/GetNotebookCell?notebook_id=${notebookID}&cell_id=${cellID}`, {headers: header}).then(response => {
                    return response.json()
                }).then(data => {
                    let query = data.input;
                    if (query.trim().toLowerCase() === 'select * from clients()') {
                        clientInfoNotebook = notebookID
                        let version = metadata.timestamp
                        updateClientInfoData(clientInfoNotebook, cellID, version, localStorage.getItem('csrf-token'));
                    }
                });
            });
        });
    });
}

function loadFromClientInfoCell(notebookID, cellID, version, startRow = 0, toRow = 1000) {
    fetch(url + `/api/v1/GetTable?notebook_id=${notebookID}&client_id=&cell_id=${cellID}&table_id=1&TableOptions=%7B%7D&Version=${version}&start_row=${startRow}&rows=${toRow}&sort_direction=false`,
        {headers: header}
    ).then(response => {
        return response.json()
    }).then(data => {
        clientIDs = []
        let clientRows = []
        data.rows.forEach(row => {
            row = row.cell;
            let entry = {}
            for (i = 0; i < row.length; i++) {
                let value = null
                try {
                    value = JSON.parse(row[i]);
                } catch (e) {
                    value = row[i];
                }
                entry[data.columns[i]] = value;
            }
            clientRows.push(JSON.stringify(entry));
            console.debug(entry)
            clientIDs.push(entry["client_id"]);
        });
        // show loading spinner
        loadClientInfo(clientRows.join("\n"))
        caseData.clientIDs = clientIDs;
        // if there are more rows, load them
        if (data.total_rows > toRow) {
            loadFromClientInfoCell(notebookID, cellID, version, startRow + toRow, toRow + 1000);
        }
    });

}


function getFromMonitoringArtifact() {
    let notebookIDStart = "N.E." + monitoringArtifact
    console.log("checking for monitoring artifact data...")
    // iterate over notebooks to find the one with the monitoring artifact
    // check if caseData has clientMonitoringLatestUpdate set
    if (caseData.clientMonitoringLatestUpdate === undefined) {
        caseData.clientMonitoringLatestUpdate = {}
    }
    caseData.clientIDs.forEach(clientID => {
        console.debug("checking monitoring artifact for clientID: " + clientID)
        let latestUpdate = caseData.clientMonitoringLatestUpdate[clientID] || 0;
        fetch(url + `/api/v1/GetTable?client_id=${clientID}&artifact=${monitoringArtifact}&type=CLIENT_EVENT&start_time=${latestUpdate}&end_time=9999999999&rows=10000`, {
            headers: header
        }).then(response => {
            return response.json()
        }).then(data => {
            console.debug("monitoring data for clientID: " + clientID)
            console.debug(data)
            if (data.rows === undefined) {
                return;
            }
            let rows = data.rows;
            let serverTimeIndex = data.columns.indexOf("_ts");
            let monitoringData = []
            let maxUpdatedTime = 0;
            rows.forEach(row => {
                console.debug(`row time: ${row.cell[serverTimeIndex]}, lastUpdatedTime: ${latestUpdate}`)
                if (row.cell[serverTimeIndex] > latestUpdate) {
                    if (row.cell[serverTimeIndex] > maxUpdatedTime) {
                        console.debug("updating maxUpdatedTime to" + row.cell[serverTimeIndex])
                        maxUpdatedTime = row.cell[serverTimeIndex];
                    }
                    let entry = {}
                    row.cell.forEach((cell, i) => {
                        try {
                            cell = JSON.parse(cell);
                        } catch (e) {
                        }
                        if (data.columns[i] === "LogonTimes") {
                            // if the column is LogonTimes is not an array, make it one
                            if (!Array.isArray(cell)) {
                                cell = [cell];
                            }
                        }
                        entry[data.columns[i]] = cell;
                    });
                    if (entry) {
                        console.debug(entry)
                        monitoringData.push(JSON.stringify(entry));
                    }
                }
            });
            caseData.clientMonitoringLatestUpdate[clientID] = maxUpdatedTime;
            if (monitoringData.length > 0) {
                console.debug("monitoring data for clientID: " + clientID + " is being processed with " + monitoringData.length + " entries")
                processJSONUpload(monitoringData.join("\n")).then(() => {
                    console.log("monitoring data processed");
                    storeDataToIndexDB(header["Grpc-Metadata-Orgid"]);
                });
            }
        });
    });
}

function changeBtn(replaceBtn, text, ordID) {
    let newBtn = document.createElement("button");
    // get child btn from replaceBtn and copy the classes to the new btn
    newBtn.className = replaceBtn.children[0].className;
    replaceBtn.innerHTML = ""
    newBtn.innerText = text;
    newBtn.addEventListener("click", evt => {
        evt.preventDefault()
        getClientInfoFromVelo();
        getHunts(ordID);
    });
    replaceBtn.appendChild(newBtn)
}

function loadDataFromDB(orgID) {
    // check if casedata with orgID is already in indexedDB
    retrieveDataFromIndexDB(orgID);
}

function syncFromMonitoringArtifact() {
    return setInterval(getFromMonitoringArtifact, 60000);
}

function stopMonitoringAync(id) {
    clearInterval(id);
}

function createSyncBtn() {
    let syncBtn = document.createElement("input");
    /*
    <div class="form-check form-switch ms-2">
                        <input class="form-check-input" id="darkSwitch" type="checkbox">
                        <label class="form-check-label" for="darkSwitch">Dark Mode</label>
                    </div>
     */
    // add classes to make it a bootstrap toggle button
    syncBtn.className = "form-check-input";
    syncBtn.type = "checkbox";
    syncBtn.id = "syncBtn";
    let syncLabel = document.createElement("label");
    syncLabel.className = "form-check-label";
    syncLabel.innerText = "Life Data";
    syncLabel.setAttribute("for", "syncBtn");
    syncBtn.addEventListener("click", evt => {
        let syncID = syncFromMonitoringArtifact();
        evt.target.innerText = "Stop";
        evt.target.removeEventListener("click", evt);
        evt.target.addEventListener("click", evt => {
            stopMonitoringAync(syncID);
            evt.target.innerText = "Life Data";
            evt.target.removeEventListener("click", evt);
            evt.target.addEventListener("click", evt);
        });
    });
    let wrapper = document.createElement("div");
    wrapper.className = "form-check form-switch ms-2";
    wrapper.appendChild(syncBtn);
    wrapper.appendChild(syncLabel);
    document.getElementById("casesBtnGrp").innerHTML = "";
    document.getElementById("casesBtnGrp").appendChild(wrapper);
}

function checkForVelociraptor() {
    fetch(url + '/api/v1/GetUserUITraits', {headers: header}).then(response => {
        return response.json()
    }).then(data => {
        let orgID = data.interface_traits.org;
        if (orgID === undefined) {
            console.log("No ordID available. Running in standalone mode... may you try to select an organization.");
            return;
        }
        header = {"Grpc-Metadata-Orgid": orgID}
        // hide the Upload button
        let replaceBtn = document.getElementById("dataBtnWrapper");
        changeBtn(replaceBtn, "Load " + orgID, orgID);
        loadDataFromDB(orgID);
        createSyncBtn()
        //getHunts(orgID);
    }).catch(error => {
        console.log("seems to be not connected to Velociraptor.");
    });
}