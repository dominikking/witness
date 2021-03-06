import '../../shim.js';
import Eos from 'eosjs';
import axios from 'axios';
import {
  FETCH_REPORTS_REQUEST,
  FETCH_REPORTS_SUCCESS,
  FETCH_REPORTS_FAILURE,
  CREATE_RECORD_REQUEST,
  CREATE_RECORD_SUCCESS,
  CREATE_RECORD_FAILURE
} from './types';
import { encrypt, decrypt } from './CryptoHelper';
import config from '../../config';

const getTableRows = () => {
  return new Promise((resolve, reject) => {
    const eos = Eos();
    eos
      .getTableRows({
        json: true,
        code: 'testacc', // contract who owns the table
        scope: 'testacc', // scope of the table
        table: 'reportstruct', // name of the table as specified by the contract abi
        limit: 100
      })
      .then(result => {
        resolve(result);
      })
      .catch(e => {
        reject(e);
      });
  });
};

export const createReport = ({ keys, answers }) => {
  return dispatch => {
    dispatch({ type: CREATE_RECORD_REQUEST });

    // Wrap data
    const report = {};
    let i = 0;
    for (const answer of answers) {
      const key = keys[i];
      report[key] = answer;
      i++;
    }

    const plainText = JSON.stringify(report);
    const { privateKey, publicKey, account } = config;
    const res = encrypt({ privateKey, publicKey, plainText });
    // const encryptedJSON = JSON.stringify(res);

    const pinataApiKey = config.pinata_api_key;
    const pinataSecretApiKey = config.pinata_secret_api_key;

    const url = `https://api.pinata.cloud/pinning/pinJSONToIPFS`;
    axios
      .post(url, res, {
        headers: {
          pinata_api_key: pinataApiKey,
          pinata_secret_api_key: pinataSecretApiKey
        }
      })
      .then(response => {
        //handle response here
        console.log(response);

        pushTransaction({
          account,
          privateKey,
          hashedMessage: response.data.IpfsHash
        })
          .then(() => {
            console.log('Successfully created!');
            dispatch({
              type: CREATE_RECORD_SUCCESS,
              payload: true
            });
          })
          .catch(e => {
            dispatch({
              type: CREATE_RECORD_FAILURE,
              payload: e
            });
          });
      })
      .catch(error => {
        //handle error here
        dispatch({ type: CREATE_RECORD_FAILURE, payload: error });
      });
  };
};

const pushTransaction = ({ account, privateKey, hashedMessage }) => {
  return new Promise(resolve => {
    // prepare variables for the switch below to send transactions
    let actionName = '';
    let actionData = {};

    // define actionName and action according to event type
    actionName = 'post';
    actionData = {
      _user: account,
      _hashedMessage: hashedMessage
    };

    // eosjs function call: connect to the blockchain
    const eos = Eos({ keyProvider: privateKey });
    eos
      .transaction({
        actions: [
          {
            account: 'testacc',
            name: actionName,
            authorization: [
              {
                actor: account,
                permission: 'active'
              }
            ],
            data: actionData
          }
        ]
      })
      .then(res => {
        resolve(res);
      });
  });
};

const fetchReports = () => {
  return new Promise((resolve, reject) => {
    getTableRows()
      .then(res => {
        resolve(res.rows);
      })
      .catch(e => {
        reject(e);
      });
  });
};

export const retrieveAndDecryptData = () => {
  return dispatch => {
    dispatch({ type: FETCH_REPORTS_REQUEST });
    fetchReports()
      .then(reports => {
        let i = 0;
        const promises = [];
        for (const report of reports) {
          console.log(report.hashedMessage);

          const promise = axios({
            url: `https://ipfs.io/ipfs/${report.hashedMessage}`,
            timeout: 1000
          })
            .then(response => {
              console.log(response);

              const { nonce, message, checksum } = response.data;

              const { privateKey, publicKey } = config;
              const res = decrypt({
                privateKey,
                publicKey,
                nonce,
                encryptedMessage: message,
                checksum
              });
              return res;
            })
            .catch(error => {
              // handle error
              console.log(error);

              dispatch({ type: FETCH_REPORTS_FAILURE, payload: error });
            });
          promises.push(promise);
          i += 1;
        }
        Promise.all(promises).then(res => {
          dispatch({ type: FETCH_REPORTS_SUCCESS, payload: res });
        });
      })
      .catch(e => {
        dispatch({ type: FETCH_REPORTS_FAILURE, payload: e });
      });
  };
};
